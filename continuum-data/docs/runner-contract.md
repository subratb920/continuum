# continuum-data — Runner contract

How the worker runs a pipeline step in a continuum-data-runner container, and what each op reads and writes. The worker and the runner agree on this file and nothing else.

Related: [Phase 1 spec](phase1-spec.md) (Sections 3, 4 and 5.3)

Status: D1, written with the D1 build (2026-10-16).

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

## 4. Tests

Every op has a pytest in `runner-image/tests/` on small fixtures in `runner-image/tests/fixtures/`. `cdata licences` exits 1 when an installed Python package is not MIT, Apache-2.0, BSD, ISC, PSF, MPL-2.0 (certifi only) or listed in `runner-image/licence-exceptions.json`.
