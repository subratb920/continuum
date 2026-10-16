# continuum-data — Runner contract

How the worker runs a pipeline step in a continuum-data-runner container, and what each op reads and writes. The worker and the runner agree on this file and nothing else.

Related: [Phase 1 spec](phase1-spec.md) (Sections 3, 4 and 5.3)

Status: D1 and D2 (a, b, c), written with the builds (2026-10-16).

## 1. Starting a step

- Image: `continuum-data-runner` (`continuum-data/runner-image/`).
- Command: `cdata <op>`. Parameters come as JSON in the `CDATA_PARAMS` environment variable.
- `/store` is the owning user's folder (`<store>/<userId>/`), mounted read-write. Every path in the parameters is relative to `/store`. A path that is absolute or leaves `/store` (`..`) is refused with exit code 2.
- Working files go in `/tmp` (a tmpfs). The root file system is read-only.
- Network: none, except for `fetch`.

## 2. Output protocol

- The runner writes one JSON object per line on stdout. Anything else on stdout is a bug. Python warnings go to stderr, which the worker records as log lines.

| kind | Fields | Meaning |
|---|---|---|
| `log` | `message` | A line for the run log, in plain words. |
| `progress` | `done`, `total` (or null), `unit` (`rows`, `files`, `bytes`) | Progress of the current step. |
| `metric` | `name`, `value` | A number to show on the step card (e.g. `rows_read`). |
| `result` | op-specific (below) | Written exactly once, last, on success. |
| `error` | `code`, `message` | Written before a non-zero exit. |

- Exit code 0: success, with exactly one `result` line. Exit code 2: bad parameters. Exit code 1: any other failure.
- **Output is all-or-nothing.** An op that writes a folder (`output`) builds it in `<output>.partial` and renames it to `<output>` only at the end, after removing any earlier `<output>` or `<output>.partial` left by a crash. A rerun of the same step therefore leaves exactly one result.

## 3. Ops in D1

### 3.1 fetch

Downloads files. The only op with network access.

Params:
```json
{ "output": "raw/<runId>",
  "files": [{ "url": "https://…", "path": "train/0000.parquet", "bytes": 20979968, "sha256": null }],
  "maxBytes": 5368709120,
  "headers": {} }
```
- Downloads each file to `<output>/<path>`, following redirects, retrying three times with back-off, resuming partial files with `Range` when the server supports it.
- Checks `bytes` and `sha256` when given. Stops with error `TOO_BIG` when the total would pass `maxBytes`.
- Only `https://` URLs (and `http://` when `allowHttp` is true).
- Every host is resolved before connecting, on every try and every redirect. A host that resolves to a private, loopback, link-local, reserved or multicast address is refused (`PRIVATE_ADDRESS`), so a link can't reach Continuum's own services or the local network. `Authorization` and other credentials are dropped when a redirect goes to another host.
- `extract` (D2c, default false): `.zip`, `.tar`, `.tar.gz` and `.tgz` files are unpacked into a folder of their name and then removed. Paths that leave that folder are refused (`UNSAFE_ARCHIVE`); links and devices are skipped; unpacking stops past `maxBytes` (`TOO_BIG`) or 100,000 files (`TOO_MANY_FILES`). The result's file entries get `unpacked: { files, bytes }`.
- `headers` may carry a source's token (Kaggle). The worker adds it for this run only; it is never stored with the run.
- Progress in bytes.
- Result: `{ "files": [{ "path", "bytes", "sha256" }], "bytes": <total> }`.

### 3.2 ingest

Turns the files in a folder into a canonical dataset version (spec Section 3).

Params:
```json
{ "input": "raw/<runId>" ,
  "output": "datasets/<datasetId>/<versionId>",
  "sourceId": "<hex>", "licence": "cc-by-4.0",
  "modality": null, "task": null,
  "textColumn": null, "labelColumn": null,
  "labelNames": ["neg", "pos"],
  "maxRows": null,
  "keepSplits": true }
```
- Reads every supported file under `input`, recursively: `.csv`, `.tsv`, `.json`, `.jsonl` / `.ndjson`, `.parquet`, `.xlsx`, `.txt`, `.md`, `.html` / `.htm` (visible text), `.pdf` (text). Hidden files and `__MACOSX` are skipped. Files with the same columns are stacked; `.txt`, `.md`, `.html` and `.pdf` files become one row each (`text`, plus `title` = the file name).
- When `keepSplits` is true and a file sits under a folder named `train`, `validation` / `valid` / `val` / `dev`, or `test`, its rows get that `_split` (`validation` for all four validation spellings).
- `modality` (`text` or `tabular` in D1) and `task` are detected when null:
  - **Chat:** a `messages` or `conversations` column of lists of `{role, content}` (also `{from, value}`, ShareGPT style) → `text` / `chat`, column `messages`.
  - **Instruction:** `instruction` + `output` (+ optional `input`), or `prompt` + `response`/`completion`, or `question` + `answer` → `text` / `chat`, converted to `messages` (`user` then `assistant`; `input` is appended to the instruction after a blank line).
  - **Text:** `textColumn`, or a column named `text`, `sentence`, `review`, `content`, `document`, `comment`, `tweet`, `body`, or else the string column with the longest average length when that is over 40 characters → `text`; the text column is renamed `text`. Task `classify` when there is a label, otherwise `generate`.
  - **Tabular:** otherwise. Task `classify` when the label has at most 50 distinct values or is a string, `regress` when it is a number with more.
  - The label is `labelColumn`, or a column named `label`, `labels`, `target`, `class`, `category`, `sentiment`, `y` or `outcome`, or, for tabular only, the last column. For text, a label column renamed `label`; for tabular, the label keeps its name and gets role `label`.
- `labelNames`: integer labels are mapped to these names (`label` becomes a string). A negative label (Hugging Face's "no label") becomes null.
- Adds `_id` (the first 16 hex characters of SHA-256 over `sourceId` and the row's JSON), `_source`, `_licence`, `_split` (string or null) and `_flags` (empty list of strings).
- Writes Parquet with Snappy compression to `<output>/data/part-00000.parquet`, … at most 200,000 rows each. Then `manifest.json` (spec 3.6, with `files` hashes).
- Stops after `maxRows` rows when given.
- Result:
```json
{ "rows": 25000, "bytes": 33000000,
  "modality": "text", "task": "classify",
  "schema": [{ "name": "text", "type": "string", "role": "input" }, { "name": "label", "type": "string", "role": "label" }, { "name": "_id", "type": "string", "role": "meta" }],
  "labels": ["neg", "pos"],
  "splits": { "train": 25000 } }
```
  `schema` types are `string`, `integer`, `float`, `boolean`, `date`, `datetime`, `list`, `struct`. Roles are `input`, `label` or `meta` (the `_` columns are always `meta`). `labels` is null when there is no label or the task is `regress`. `splits` is null when no row has a `_split`.

### 3.3 profile

Measures a version and writes `<input>/profile.json`. It does not create a version. It writes `profile.json` through a temporary file and a rename.

Params: `{ "input": "datasets/<datasetId>/<versionId>", "sampleRows": 100000 }`

`profile.json`, and the same object as the `result` line without `columns[].histogram` and `columns[].top`:
```json
{ "rows": 25000, "sampled": 25000, "modality": "text", "task": "classify",
  "duplicates": { "exact": 96 },
  "missing": { "cells": 0, "rows": 0 },
  "labels": { "column": "label", "counts": [{ "value": "neg", "count": 12500 }], "balance": 1.0 },
  "splits": { "train": 25000 },
  "text": { "column": "text", "chars": { "mean": 1325, "p50": 979, "p95": 3432, "max": 13704 },
            "words": { "mean": 234, "p50": 174 }, "tokensApprox": 7600000, "empty": 0,
            "histogram": [{ "from": 0, "to": 500, "count": 4000 }] },
  "columns": [{ "name": "text", "type": "string", "role": "input", "missing": 0, "distinct": 24904,
                "min": null, "max": null, "mean": null, "p25": null, "p50": null, "p75": null,
                "histogram": [{ "from": 0, "to": 1, "count": 3 }],
                "top": [{ "value": "…", "count": 3 }] }],
  "findings": [{ "id": "exact_duplicates", "severity": "warning", "message": "96 rows are exact copies of another row.", "suggest": "dedupe" }] }
```
- Exact duplicates are counted over the non-`_` columns.
- `labels.balance`: the smallest label count divided by the largest (1.0 is perfectly balanced).
- `text` is present for text datasets (for chat data, over all message contents joined), otherwise null. `tokensApprox` is words × 1.3 over all rows (from the sample, scaled).
- Numeric columns get `min`, `max`, `mean`, `p25`, `p50`, `p75` and a 10-bin `histogram`; string columns get `top` (at most 10 values, each cut to 200 characters); text lengths get a 10-bin histogram up to p99.
- Findings (each optional), in plain words a beginner understands: `exact_duplicates` (warning, suggest `dedupe`), `missing_values` (warning when a column is more than 5% empty, suggest `fill_missing`), `imbalanced_labels` (warning when balance < 0.5, suggest `balance`), `few_rows` (warning under 1,000 rows, or under 100 for any label), `empty_text` (warning, suggest `filter`), `very_long_text` (info when p95 over 8,000 characters), `single_value_column` (info), `no_label` (info for text and tabular data without a label), `has_splits` (info).

## 3a. Clean-up ops (D2)

Every op below reads the version at `input` and, except `validate` and `export`, writes a new version at `output` (all-or-nothing, as in Section 2). A new version has the same manifest shape as `ingest`'s, plus `parent` and `madeBy`. It also has `changes.json`:

```json
{ "op": "dedupe", "before": 25000, "after": 24904, "removed": 96, "changed": 0,
  "notes": ["96 exact copies", "Kept the first row of each group."],
  "sample": [{ "_id": "…", "reason": "exact copy", "row": { "text": "… (cut to 300 characters)", "label": "neg" } }] }
```

The `result` line is `ingest`'s (`rows`, `bytes`, `modality`, `task`, `schema`, `labels`, `splits`) plus `changes` (the file above without `sample`). An op that would remove every row stops with error `NO_ROWS_LEFT` and writes nothing.

| Op | Params (defaults) | What it does |
|---|---|---|
| `dedupe` | `mode` (`near` for text, else `exact`), `threshold` 0.8, `keep` `first` / `longest` / `shortest` | Exact copies: a hash of the non-`_` columns. Near copies (text): MinHash over word 5-grams (64 hashes, 16 bands of 4, polars only); a pair counts when its estimated similarity reaches `threshold`. Texts under 5 words use the whole text as one shingle. |
| `filter` | `dropEmpty` true, `minChars`, `maxChars`, `minWords`, `maxSymbolShare`, `maxRepeatedLineShare`, `dropMissingLabel` true, `dropFlags` [], `keepWhere` | Removes rows matching any rule; `keepWhere` is a polars SQL expression (an expression only, never code; error `BAD_CONDITION` when it can't be read). |
| `fix_types` | `stripSpaces` true, `columns` | Text columns whose every value is a number become numbers (integers when whole); yes/no/true/false become booleans. The label is left as it is. |
| `fill_missing` | `strategy` `auto` / `median` / `mean` / `mode` / `constant` / `drop`, `value`, `columns`, `dropMissingLabel` true | `auto`: median for numbers, most common value otherwise. |
| `outliers` | `action` `clip` / `drop`, `factor` 1.5, `columns` | Interquartile-range fences per number column. |
| `split` | `mode` `stratified` (with a label) / `random` / `group` / `keep`, `ratios` [0.8, 0.1, 0.1], `groupColumn`, `seed` 42, `leakageCheck` true | Fills `_split` with train / validation / test (largest-remainder counts, so they add up). Leakage check: rows in one exact or near-copy group that sit on more than one side all move to train. The same seed gives the same split. |

| `redact_pii` | `action` `replace` / `drop` / `flag`, `kinds` (all: `email`, `phone`, `card`, `iban`, `aadhaar`, `ssn`, `pan`, `ip`) | Checks every text column (and chat message contents) except the label. `replace` puts in `[EMAIL]`, `[PHONE]`, `[CARD]`, `[IBAN]`, `[ID]` or `[IP]` and flags the row `pii_redacted`. Card numbers must pass the Luhn check; phone numbers need 8 to 15 digits. Names aren't found yet (D4, with a model). |
| `safety` | `action` `drop` / `flag`, `extraWords` [] | A whole-word check against a short built-in list of clearly adult or abusive words, plus `extraWords`. `flag` adds `unsafe`. The `changes.json` sample gives only row ids and the reason, never the text. A model-based check comes in D4. |
| `balance` | `method` `under` / `over` / `both`, `targetRatio` 1.0, `seed` 42 | Needs a label (error `NO_LABEL`). Only `train` rows change when the data is split; validation and test keep the real mix. Added copies get new `_id`s (`<id>-o<n>`) and the flag `oversampled`. |
| `to_chat` | `mode` `columns` (`promptColumn`, `answerColumn`) / `classify` (`textColumn` "text", `instruction`), `systemPrompt`, `dropOtherColumns` true | Writes `messages` (an optional system turn, then user, then assistant) and sets the task to `chat`. |

### validate

Params: `input`, `minRows` (1,000 for text, 100 otherwise), `minRowsPerLabel` 100, `maxMissingShare` 0.2. Writes `<input>/quality.json` and the same object as the result:

```json
{ "score": 82, "verdict": "Nearly there", "passed": 8, "total": 10,
  "gates": [{ "id": "has_test_split", "title": "Rows kept aside for testing", "passed": true, "reason": "5,000 rows kept aside to check the model.", "weight": 10, "fix": "split" }] }
```

Gates: `enough_rows`, `enough_per_label`, `balanced`, `labelled`, `few_missing`, `no_copies`, `has_test_split`, `no_leakage` (with a split), `licences_known`, `no_empty_text` (text). The score is the share of the gates' weights that passed. A score of 85 or more is "Ready to train"; 60 or more is "Nearly there".

### export

Params: `input`, `output` (`exports/<versionId>`), `format` `parquet` / `csv` / `jsonl` / `hf`, `includeMeta` false, `card` (from the engine: `name`, `goal`, `sources` [{ title, ref, licence }], `history` [{ number, op, label, notes }], `quality`). Writes `<output>/<format>.zip`, through a temporary file and a rename. The zip holds:
- one file per split (or `data.*` without splits)
- `README.md`: the dataset card, made from `card` (what's in it, where it came from and under which licences, how each version was made, the quality checks, and a note on using it with care)
- `manifest.json`

With `hf`, the zip holds `data/<split>.parquet` and a README whose `configs:` front matter lets `datasets.load_dataset` read it. The `_` columns are left out unless `includeMeta`. Result: `{ path, format, bytes, splits }`.

## 4. Tests

Every op has a pytest in `runner-image/tests/` on small fixtures in `runner-image/tests/fixtures/`. `cdata licences` exits 1 when an installed Python package is not MIT, Apache-2.0, BSD, ISC, PSF, MPL-2.0 (certifi only) or listed in `runner-image/licence-exceptions.json`.
