# Continuum Data: Phase 1 Implementation Spec

The specification for continuum-data, Continuum's data engineering engine, precise enough to build from.

Related: [Continuum README](../../README.md) · [continuum-deploy spec](../../../continuum-deploy/docs/phase1-spec.md) · [continuum-brain README](../../../continuum-brain/README.md)

| Purpose | Phase 1 scope |
|---|---|
| Let anyone, including a school student, go from "I want a model that does X" to a clean, versioned dataset that is ready to train on, from inside Continuum's UI. | Text (including LLM instruction and chat data), tabular, image and audio datasets. Sources: uploads, Hugging Face, Kaggle, OpenML, UCI, any URL. The full pipeline (discover, acquire, ingest, profile, clean, improve, transform, split, validate, publish) with AI help. Runs in Docker on the Continuum host. The user's own cloud follows in a later phase. |

Status: Version 1.0 for D1, accepted by the owner on 2026-10-16 with every proposal in Section 12. D1 is built as written here; where the build changed a detail, the section says so (marked "D1 build"). Based on the owner's decisions of 2026-10-16: local Docker first and cloud later; all four data types; an engine inside Continuum, not a separate deployment unit, but able to be split out later; AI help from the first phase.

## Contents and review status

| Section | Topic | Status |
|---|---|---|
| 1 | Overall architecture | Draft 0.1 |
| 2 | Data model (MongoDB collections, storage layout) | Draft 0.1 |
| 3 | Canonical dataset formats | Draft 0.1 |
| 4 | Pipeline steps (ops) | Draft 0.1 |
| 5 | Runs, jobs and the runner container | Draft 0.1 |
| 6 | API endpoints | Draft 0.1 |
| 7 | Source catalogue and connectors | Draft 0.1 |
| 8 | AI assistance | Draft 0.1 |
| 9 | Safety, licences and limits | Draft 0.1 |
| 10 | UI screens | Draft 0.1 |
| 11 | Build phases and acceptance criteria | Draft 0.1 |
| 12 | Questions for the owner | Answered (2026-10-16) |

## 1. Overall architecture

### 1.1 Ground rules

- The engine is our own code: catalogue, state, queue, orchestration, versioning and UI. Data work itself uses well-known open-source Python libraries inside a runner container, each under a permissive licence (Section 9.3).
- continuum-data is a module inside the Continuum repository. It is mounted into continuum-api and started with it, so there is no extra deployment unit (owner's decision, 2026-10-16).
- It is built so it can be split out later: it never imports continuum-api code, it keeps its own MongoDB database (continuum_data), and the UI reaches it only through its own base address (Section 1.5).
- Heavy work never runs inside the Node process. Every pipeline step runs in a disposable continuum-data-runner container. Node only orchestrates, reads small samples and serves previews.
- Every step writes a new, immutable dataset version. Nothing is changed in place, so any step can be compared, undone or traced back to its sources.
- Every row keeps its source and licence. A dataset never loses the record of where its data came from.
- Safe by default: PII redaction and the content safety filter are on unless the user turns them off (Section 9).
- Secrets (Hugging Face and Kaggle tokens, model keys) never appear in URLs, logs, the browser or a runner's logs. They are stored sealed, as Deploy does with `secretbox`.

### 1.2 Where the code lives

- In the existing Continuum repository: `/Users/subratbehera/development/continuum-claude/continuum/continuum-data`, next to continuum-api and continuum-bridge-spine.
- JavaScript ESM, Node 22, Express 5 router, the MongoDB 7 driver. Same idiom as continuum-api (plain JS, not TypeScript), so it mounts without a build step.
- The runner image is Python 3.12 (`continuum-data/runner-image/`).
- The UI lives in continuum-bridge-spine as a console screen (`src/screens/data/`) with its own client (`src/data/`).

### 1.3 Parts

| Part | What it does | What it never does |
|---|---|---|
| `src/api/` | `createDataRouter({ db, auth, projects, config })`: the HTTP routes under `/data`, upload handling, live events (SSE). Writes jobs to the queue. | Process data; hold long-running work. |
| `src/worker/` | `startDataWorker({ db, config })`: claims jobs and drives runs step by step, starting runner containers and recording results. | Serve HTTP. |
| `src/store/` | Collections, indexes, the lease queue, versioned writes, audit. The only code that touches continuum_data. | Touch the continuum database. |
| `src/storage/` | `StorageDriver`: where dataset files live. Phase 1: a local Docker volume. Later: S3 or GCS. | Decide anything about data. |
| `src/runtime/` | `RunnerDriver`: starts, follows and removes runner containers. Phase 1: Docker Engine API over the socket (the pattern of continuum-brain's `docker-client.ts`). Later: the user's cloud. | Run code in the Node process. |
| `src/catalogue/` | Source connectors (search, describe, fetch plan) and the growing source registry. | Download large files itself; the runner does that. |
| `src/ai/` | `generate()` and `embed()` across the model providers brain supports. | Send a user's data to a provider the user did not choose. |
| `runner-image/` | The `cdata` command line: one op per pipeline step, reading and writing Parquet and media files. | Reach Continuum's database or other users' files. |

### 1.4 How it connects

```
 Browser (continuum-bridge-spine, "Data" screen)
     │ Bearer <Continuum JWT>                    SSE: /data/events
     ▼
 continuum-api :45170
     ├─ /data/*  ← createDataRouter(...)  (requireAuth passed in as `auth`)
     └─ server.js starts startDataWorker(...) when DATA_ENABLED=true
     │
     ├─ MongoDB continuum-mongo:45171, database continuum_data
     ├─ Docker Engine (/var/run/docker.sock) ──► continuum-data-runner containers
     │                                            mount: continuum_data_store volume (one user's folder only)
     └─ Model providers (Ollama on host.docker.internal, Anthropic, OpenAI, OpenAI-compatible)
```

### 1.5 The split-out seam

The module depends only on what it is given:

| Input | Phase 1 (inside continuum-api) | Later (own server) |
|---|---|---|
| `db` | continuum-api's MongoClient, database continuum_data | its own MongoClient |
| `auth` | continuum-api's `requireAuth` (sets `req.user.id`) | Deploy-style SSO (`/oauth/authorize`, audience continuum-data) |
| `projects` | a read-only function over the projects collection | a client of continuum-api's `/service` routes |
| `config` | `DATA_*` settings read by continuum-api's env.js | its own env |

The UI uses `VITE_DATA_API_URL` (default: `VITE_API_URL` + `/data`). Moving to a separate server is then a new `server.js`, a Dockerfile and a changed address. No other code changes.

### 1.6 Settings

| Setting | Default | Meaning |
|---|---|---|
| `DATA_ENABLED` | unset | Mounts `/data` and starts the worker. When unset, the UI hides the Data screen (as with Deploy's `VITE_DEPLOY_LOGIN_URL`). |
| `DATA_DB_NAME` | continuum_data | Database name. |
| `DATA_MONGO_URI` | `MONGO_URI` | MongoDB server; the database is `DATA_DB_NAME` on it. |
| `DATA_STORE_PATH` | /store | Where continuum-api sees the dataset files. D1 build: a folder on the host, `~/.continuum/data-store`, mounted into continuum-api and bound into runners (instead of a named volume, so continuum-api can also run outside Docker). |
| `DATA_RUNNER_URL` | http://continuum-data-runner-proxy:45191 | The runner proxy (Q1). |
| `DATA_RUNNER_TOKEN` | — (required when enabled) | Shared with the runner proxy (`PROXY_TOKEN`). |
| `DATA_WORKER_CONCURRENCY` | 2 | Steps running at once on this host. |
| `DATA_DISK_GB`, `DATA_UPLOAD_GB`, `DATA_RUNS_AT_ONCE` | 20, 5, 2 | Limits (Section 9.4). |
| `DATA_MODULE` | ../continuum-data/src/index.js | Where continuum-api loads the engine from (Compose mounts it at /continuum-data). |
| `DATA_SECRET_KEY` | — | D4: key used to seal tokens and model keys. |
| `OLLAMA_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY`, `COMPAT_URL` | as brain | Model providers (Section 8). |

### 1.7 Prerequisites from the owner

- Approve this spec, section by section.
- Build the runner image once: `docker build -t continuum-data-runner:dev continuum-data/runner-image`.
- Switch it on with `DATA_ENABLED=true` in `docker/.env` (Compose) or continuum-api's `.env.local`.

### 1.8 Decisions confirmed by the owner

- Local Docker first, the user's cloud later (2026-10-16).
- Text, tabular, image and audio data, all in scope (2026-10-16).
- An engine inside Continuum that can be split out later (2026-10-16).
- AI help built in from the first phase (2026-10-16).
- Q1 to Q6 in Section 12: every proposal accepted (2026-10-16).

## 2. Data model

### 2.1 Conventions

- Database continuum_data, on Continuum's MongoDB server. Its own database user before going live, with access to continuum_data only.
- `_id` is an ObjectId. Every user-owned document has `userId` (the Continuum user's id), and every query filters on it.
- `createdAt` and `updatedAt` on every document. Documents that change concurrently have `version` and are written with `$inc` (as Deploy's `versioned.ts`).

### 2.2 Collections at a glance

| Collection | Holds |
|---|---|
| sources | The source catalogue, shared by all users (Section 7). |
| datasets | A user's datasets. |
| versions | Immutable versions of a dataset. |
| recipes | Saved pipelines (step lists). |
| runs | One run of a recipe over a version. |
| run_events | Progress and log lines for a run. |
| review_items | Rows waiting for a person to check. |
| credentials | Sealed tokens for sources and model providers, per user. |
| jobs | The lease queue. |
| settings | Per-user settings (model choice, safety defaults). |
| audit_events | Who did what, and when. |

### 2.3 sources

| Field | Type | Notes |
|---|---|---|
| connector | string | `upload`, `huggingface`, `kaggle`, `openml`, `uci`, `url`, later more. |
| ref | string | The connector's id, e.g. `stanfordnlp/imdb`, a URL. Unique with `connector`. |
| title, description | string | |
| modalities | string[] | `text`, `tabular`, `image`, `audio`. |
| tasks | string[] | `classify`, `regress`, `detect`, `transcribe`, `chat`, `generate`, … |
| licence | object | `{ spdx, name, url, commercial: bool\|null, attribution: bool\|null }`. |
| size | object | `{ bytes, rows, files }`, when known. |
| tags | string[] | |
| popularity | number | Downloads or likes from the connector, plus Continuum uses. |
| uses | number | How many datasets were built from it. |
| addedBy | string | `seed`, `search`, `user`, `ai`. |
| ownerUserId | ObjectId\|null | Set only for private sources (uploads, private URLs). These are visible only to their owner. |
| checkedAt | date | Last time the connector confirmed it still exists. |

Indexes: `{connector, ref}` unique; text index on title, description and tags; `{modalities, tasks}`.

### 2.4 datasets

| Field | Type | Notes |
|---|---|---|
| userId | ObjectId | |
| name | string | Unique per user. |
| goal | string | The plain-words goal, e.g. "tell cats from dogs". |
| modality | string | One of the four. |
| task | string | |
| projectId | ObjectId\|null | Optional link to a Continuum project. |
| headVersionId | ObjectId\|null | The latest version. |
| publishedVersionId | ObjectId\|null | The version marked ready for training. |
| sourceIds | ObjectId[] | |

### 2.5 versions

| Field | Type | Notes |
|---|---|---|
| userId, datasetId | ObjectId | |
| number | number | 1, 2, 3, … per dataset. |
| parentVersionId | ObjectId\|null | |
| madeBy | object | `{ runId, stepIndex, op, params }`, or `{ op: "ingest", sourceIds }` for the first version. |
| contentHash | string | SHA-256 over the manifest's file hashes. Two identical results share a hash. |
| path | string | Storage path (Section 2.12). |
| rows | number | |
| bytes | number | |
| schema | object[] | `{ name, type, role }`, where role is `input`, `label`, `meta` or `media`. |
| splits | object\|null | `{ train, validation, test }` row counts, once split. |
| labels | string[]\|null | The label map, for classification. |
| profileSummary | object | Headline numbers for the UI (Section 4.4). |
| quality | object\|null | `{ score, gates: [{ id, passed, reason }] }` (Section 4.9). |
| licences | object[] | Licence counts across rows. |
| frozen | bool | True once published; a frozen version can never be removed while a project refers to it. |

### 2.6 recipes

| Field | Type | Notes |
|---|---|---|
| userId | ObjectId\|null | Null for built-in templates. |
| name, description | string | |
| modality, task | string | |
| steps | object[] | `{ op, params, enabled }`, in order. |
| origin | string | `template`, `user`, `ai`. |

### 2.7 runs

| Field | Type | Notes |
|---|---|---|
| userId, datasetId, recipeId | ObjectId | |
| inputVersionId | ObjectId | |
| state | string | Section 5.1. |
| steps | object[] | Copy of the recipe's steps plus `{ state, outputVersionId, metrics, startedAt, endedAt, error }`. |
| currentStep | number | |
| eventSeq | number | Increased with `$inc` for each run_event. |
| version | number | Versioned writes. |

### 2.8 run_events

`{ runId, userId, seq, at, kind, stepIndex, message, data }`, where kind is `state`, `log`, `progress` or `warning`. Index `{runId, seq}` unique. Kept for 30 days.

### 2.9 review_items

`{ userId, datasetId, versionId, rowId, reason, suggested, confidence, state, answer, answeredAt }`. State is `open`, `accepted`, `changed` or `skipped`. Answers are applied by the `review.apply` op, which writes a new version.

### 2.10 credentials

`{ userId, kind, sealed, hint, createdAt }`. Kind is `huggingface`, `kaggle`, `anthropic`, `openai`, `opencode` or `compat`. `hint` is the last four characters, for the UI. Values are sealed with `DATA_SECRET_KEY` (AES-256-GCM).

### 2.11 jobs, settings, audit_events

- jobs: the same shape and rules as Deploy's queue (Deploy spec 2.12 and Section 4): `type`, `payload`, `status`, `runAt`, `priority`, `attempts`, `maxAttempts`, `lease { owner, expiresAt, heartbeatAt }`, `fencingToken`, `lastError`, `repeatEvery`.
- settings: `{ userId, model, embedModel, safety: { pii, content }, quota }`.
- audit_events: `{ userId, at, action, target, details }`.

### 2.12 Storage layout

```
/store/<userId>/
  uploads/<uploadId>/...              raw uploaded files, removed after ingest
  raw/<sourceId>/<fetchId>/...        downloaded files, shared by the user's datasets
  datasets/<datasetId>/<versionId>/
    data/part-00000.parquet ...       the canonical table (Section 3)
    media/ab/abcdef….jpg ...          images and audio, named by content hash
    profile.json                      full profile (Section 4.4)
    manifest.json                     files, hashes, schema, splits (Section 3.6)
    card.md                           the dataset card
  exports/<versionId>/<format>/...
```

- Media files are hard-linked between versions when unchanged, so a version that only drops rows costs almost no disk.
- A runner mounts only `/store/<userId>/` of the user who owns the run.

### 2.13 Retention

- Unpublished versions with no child and no project link: removed after 30 days by the `gc` job, after the user is warned in the UI.
- Raw downloads and uploads: D1 build removes them as soon as the build that used them succeeds; after a failed build they stay, so "Try again" needs no new download.
- run_events: 30 days.

## 3. Canonical dataset formats

Every ingest turns its input into one of these. All later steps read and write only these.

### 3.1 Common columns

| Column | Type | Meaning |
|---|---|---|
| `_id` | string | Stable row id (a hash of the source row), kept through every step. |
| `_source` | string | The sources `_id`. |
| `_licence` | string | SPDX id or `unknown`. |
| `_split` | string\|null | `train`, `validation`, `test`, once split. |
| `_flags` | list<string> | Profile and clean findings, e.g. `near_dup`, `pii`, `lang:fr`. |

### 3.2 Text

- Classification and general text: `text`, optional `label`.
- Instruction and chat: `messages` (list of `{ role, content }`), optional `system`. Alpaca-style `instruction / input / output` is converted to `messages` on ingest.
- Pre-training corpus: `text`, `url`, `title`.

### 3.3 Tabular

The user's columns, with types inferred and stored in the version's `schema`, and one column marked as `label`, the thing to predict.

### 3.4 Image

`image` (a media path), `width`, `height`, `label` (classification) or `objects` (list of `{ bbox: [x, y, w, h], label }`, in pixels, for detection). COCO, YOLO, Pascal VOC and folder-per-label layouts are all converted to this.

### 3.5 Audio

`audio` (a media path, stored as 16-bit PCM WAV or FLAC), `sample_rate`, `duration`, optional `text` (transcript) or `label`.

### 3.6 manifest.json

```json
{
  "format": "continuum-data/1",
  "dataset": "…", "version": 4,
  "modality": "image", "task": "classify",
  "schema": [{ "name": "image", "type": "media/image", "role": "input" }, …],
  "labels": ["cat", "dog"],
  "splits": { "train": 8000, "validation": 1000, "test": 1000 },
  "files": [{ "path": "data/part-00000.parquet", "sha256": "…", "bytes": 123 }],
  "licences": [{ "spdx": "CC-BY-4.0", "rows": 10000 }],
  "createdAt": "…"
}
```

This file is the contract a later Continuum training engine reads.

## 4. Pipeline steps (ops)

Each op is one `cdata <op>` command in the runner image. Input: one version. Output: one new version, plus metrics shown in the UI. Ops that only read (profile, validate) write a report instead of a version.

### 4.1 Ops at a glance

| Stage | Op | Modalities | Phase |
|---|---|---|---|
| Acquire | `fetch` | all | D1 |
| Ingest | `ingest` | all | D1 (text, tabular), D3 (image, audio) |
| Profile | `profile` | all | D1 |
| Clean | `dedupe` | all | D2, D3 |
| Clean | `filter` | all | D2 |
| Clean | `fix_types`, `fill_missing`, `outliers` | tabular | D2 |
| Clean | `redact_pii` | text, tabular | D2 |
| Clean | `safety` | text, image | D2 (text), D3 (image) |
| Clean | `repair_media` | image, audio | D3 |
| Improve | `label` (AI) | all but tabular | D4 |
| Improve | `review.apply` | all | D4 |
| Improve | `find_label_errors` | all | D4 |
| Improve | `balance` | all | D2 |
| Improve | `augment` | image, audio, text | D3, D4 |
| Improve | `synthesise` (AI) | text, tabular | D4 |
| Improve | `to_chat` | text | D2 |
| Transform | `resize`, `resample`, `encode`, `tokenise` | as named | D3 |
| Split | `split` | all | D2 |
| Validate | `validate` | all | D2 |
| Publish | `export`, `card`, `publish` | all | D2 |

### 4.2 fetch

- Downloads what a connector's fetch plan lists (Section 7.3) into `raw/<sourceId>/<fetchId>/`.
- Resumes partial files, checks sizes and checksums, follows the connector's rate limit, and stops at the user's quota.
- The only op that runs with network access.

### 4.3 ingest

- Reads CSV, TSV, JSON, JSONL, Parquet, Excel, plain text, Markdown, HTML (main text via trafilatura), PDF (text via pypdf), image folders, COCO, YOLO, Pascal VOC, WAV, FLAC, MP3, OGG, and Hugging Face dataset files.
- Detects the format; the user can override.
- Maps columns to the canonical schema (Section 3). The mapping is proposed (by rules, then AI in D4) and shown to the user before the first version is written.
- Writes version 1, with `_id`, `_source` and `_licence` on every row.

### 4.4 profile

| For | Measures |
|---|---|
| All | Rows, columns and types, missing values per column, exact duplicates, label counts and balance. |
| Text | Language mix, length and token-count distributions, near-duplicate estimate, flagged PII and unsafe rows (when the filters have run). |
| Tabular | Per column: distinct values, min, max, mean, quartiles, outliers, correlation with the label. |
| Image | Size and aspect distributions, unreadable files, near-duplicate estimate, greyscale or colour, box counts per image. |
| Audio | Duration and sample-rate distributions, unreadable files, silence share, clipping. |

- Large datasets are profiled on a sample of up to 100,000 rows, with the sample size shown.
- Each finding has a plain-words explanation and, where there is one, a suggested fix step ("1,204 rows are near-copies. Add Remove duplicates?").

### 4.5 dedupe

- Exact: hash of the normalised content.
- Near, for text: MinHash LSH (datasketch), Jaccard threshold 0.8 by default.
- Near, for images: perceptual hash (imagehash), Hamming distance 6 or less by default.
- Near, for audio: a spectral fingerprint, threshold set per dataset.
- Keeps the first copy by default; the user can choose "keep the longest" or "keep the best quality".

### 4.6 filter

Rule-based filters, each one optional: language, length, character and symbol ratios, repeated lines, broken or unreadable media, minimum image size, audio duration range, a custom expression over columns (evaluated by DuckDB, never as Python).

### 4.7 redact_pii and safety

- redact_pii: emails, phone numbers, card numbers, national id patterns, IP addresses and street addresses, by pattern; names by a small named-entity model. Each match is replaced by a placeholder such as `[EMAIL]` or the row is dropped, as the user chooses.
- safety: toxic and adult text by a small classifier; adult and violent images by an image classifier. Matches are dropped. See Section 9.1.

### 4.8 split

- Stratified by label for classification; random otherwise; by a group column when the user names one (for example the same speaker, patient or document must stay on one side).
- Default 80 / 10 / 10, with a fixed seed shown in the UI.
- Leakage check: after splitting, near-duplicates across splits are found with the dedupe method and moved to the train side.
- Decontamination (text): rows that overlap well-known evaluation sets by 13-gram are flagged.

### 4.9 validate

Quality gates, each with a plain-words reason:

| Gate | Default |
|---|---|
| Enough rows | at least 100 per label, at least 1,000 overall for text |
| Balanced | the smallest label at least 10% of the largest |
| Few missing values | no input column more than 20% empty |
| No leakage | no near-duplicates across splits |
| Clean | no rows flagged unsafe or with unredacted PII |
| Licences known | every row's licence known, and compatible with each other |

The quality score (0 to 100) combines the gates and the profile. Publishing is allowed with failed gates, but the UI shows them clearly and the card records them.

### 4.10 export, card and publish

- Export formats: Parquet, CSV, JSONL (`messages`), Hugging Face `datasets` folder (`save_to_disk`), ImageFolder, WebDataset tar shards. Exports can be downloaded as a zip.
- Push to the Hugging Face Hub, using the user's own token, only when the user asks.
- card: a dataset card in the Hugging Face card format: goal, sources, licences, how it was made (the recipe), profile, quality gates, known limits. Written from a template, then improved by AI in D4.
- publish: freezes the version and sets `publishedVersionId`.

## 5. Runs, jobs and the runner container

### 5.1 Run states

```
queued ─► running ─► succeeded
            │  ├──► waiting_review ─► running      (a step left rows for a person to check)
            │  └──► failed
            └─────► cancelled
```

- A run moves through its steps in order. Each finished step writes its output version and becomes the next step's input.
- A failed step can be retried from that step; earlier versions stay.
- Rules for state changes match Deploy's (Deploy spec 3.1): each change is one versioned write, with an event.

### 5.2 Jobs

| Type | Does |
|---|---|
| `run.advance` | Starts the run's next step, or finishes the run. |
| `step.watch` | Follows a runner container until it exits, streaming its progress lines into run_events. |
| `catalogue.search` | Searches connectors and saves new sources. |
| `catalogue.refresh` | Every day: checks sources not checked for 30 days. |
| `gc` | Every hour: retention (Section 2.13), stray containers. |

The queue is a JS copy of Deploy's `packages/store/src/queue/` (claim with one `findOneAndUpdate`, leases, heartbeats, fencing tokens, backoff, dead jobs). Runner defaults: concurrency `DATA_WORKER_CONCURRENCY`, 60 s lease, 20 s heartbeat.

### 5.3 The runner container

- The exact contract (command, parameters, output lines, all-or-nothing output) is in [runner-contract.md](runner-contract.md).
- Image `continuum-data-runner`, started per step as `cdata <op>` with its parameters in `CDATA_PARAMS`, through continuum-data-runner-proxy (Q1), which can start nothing else.
- Mounts: the owning user's folder as `/store` (read-write). Nothing else.
- Network: none, except for `fetch` (and later AI ops), which join `continuum_data_egress`, a network of its own: the internet is reachable, Continuum's containers are not (they are on `docker_default`).
- Each try of a step has its own container name (`cdata-<runId>-<step>-<fencing token>`); starting a step first removes any earlier try of it, so only one ever writes its output.
- Limits: 2 CPUs, 4 GB memory, 2 hours by default; set per op. Non-root user, read-only root filesystem, no privileges.
- Progress protocol: the runner prints JSON lines on stdout: `{"kind":"progress","done":120,"total":1000}`, `{"kind":"log","message":"…"}`, `{"kind":"metric","name":"removed","value":42}`, `{"kind":"result","rows":958,…}`. The worker reads them through the Docker logs stream.
- Exit code 0 means success; any other code fails the step with the last `log` line as the error.
- AI ops never get model keys in their environment from the runner's side of the file system; the worker passes a short-lived local proxy address instead (Section 8.2).

### 5.4 Live events

`GET /data/events` (SSE), filtered to the user, from a MongoDB change stream on run_events, with `Last-Event-ID` catch-up. The same pattern as continuum-brain's `live.ts`.

## 6. API endpoints

All under `/data`, all requiring Continuum sign-in, all scoped to `req.user.id`. Errors are `{ error, code }`, the shape continuum-api already uses (D1 build). Another user's id answers 404, never 403.

| Method and path | Does |
|---|---|
| `GET /data/me` | The user's data settings, quota and usage. |
| `PUT /data/me/settings` | Change model choice and safety defaults. |
| `PUT /data/credentials/:kind`, `DELETE …` | Save or remove a sealed token. |
| `GET /data/sources?q=&modality=&task=` | Search the catalogue (and, when `live=1`, the connectors). |
| `GET /data/sources/:id` | One source, with its files and licence. |
| `POST /data/sources` | Add a source by URL or connector ref. |
| `POST /data/uploads` | Start an upload: `{ name }` → `{ uploadId, sourceId }`. |
| `POST /data/uploads/:id/files?path=` | One file, as the raw request body (streamed to disk, up to the limits). An upload is made into one dataset only. |
| `GET /data/datasets`, `POST /data/datasets` | List or create datasets. |
| `GET/PATCH/DELETE /data/datasets/:id` | One dataset. Delete refuses while a project refers to a published version. |
| `GET /data/datasets/:id/versions` | Its versions. |
| `GET /data/versions/:id` | One version, with profile summary and quality. |
| `GET /data/versions/:id/rows?offset=&limit=&filter=&split=` | Rows for the viewer (at most 200 per call), read with DuckDB from Parquet. |
| `GET /data/versions/:id/media/:hash` | One image or audio file. |
| `GET /data/versions/:id/profile` | The full profile. |
| `GET /data/versions/:a/diff/:b` | Rows added, removed and changed, and the profile change. |
| `POST /data/versions/:id/publish` | Publish. |
| `POST /data/versions/:id/exports` | Start an export; `GET …/exports` lists them; `GET …/exports/:format/download` downloads. |
| `GET /data/recipes`, `POST`, `PUT /:id`, `DELETE /:id` | Recipes and templates. |
| `POST /data/runs` | Start a run: `{ datasetId, inputVersionId, recipeId \| steps }`. |
| `GET /data/runs/:id`, `POST /data/runs/:id/cancel`, `POST /data/runs/:id/retry` | One run. |
| `GET /data/runs/:id/events?afterSeq=` | Events, for clients without SSE. |
| `GET /data/events` | SSE (Section 5.4). |
| `GET /data/review?datasetId=`, `POST /data/review/:id` | The review queue. |
| `POST /data/assist/plan` | AI: from a goal to a proposed dataset, sources and recipe (Section 8). |
| `POST /data/assist/explain` | AI: explain a finding in plain words. |
| `POST /data/assist/chat` | AI: the Inspector's assistant chat, with the dataset's context. |

The read-and-run routes brain uses (`/service/data/...`: list datasets, search sources, propose and start a recipe, run status) come in D5 and never delete anything.

## 7. Source catalogue and connectors

### 7.1 How the catalogue grows

- It starts with a seed list (Section 7.4).
- Every live search through a connector saves each result as a source (`addedBy: search`).
- Every source a user adds by URL is saved (`addedBy: user`). Public URLs become visible to everyone after the first successful fetch; private ones (uploads, URLs needing a token) stay with their owner.
- AI suggestions that check out are saved (`addedBy: ai`).
- `uses` and `popularity` rank results, so sources that make good datasets rise.
- `catalogue.refresh` marks sources that disappeared.

### 7.2 Connector interface

```js
{
  id: "huggingface",
  search({ q, modality, task, limit }) → Source[]    // metadata only
  describe(ref) → Source                              // licence, files, sizes
  fetchPlan(ref, { split, subset, maxRows }) → { files: [{ url, path, bytes, sha256? }], headers? }
  needsCredential: false | "kaggle" | …
}
```

The worker turns a fetch plan into a `fetch` step. Connectors only call public metadata APIs from Node; large downloads always happen in the runner.

### 7.3 Phase 1 connectors

| Connector | Search | Fetch | Credential |
|---|---|---|---|
| upload | — | files the user uploaded | — |
| url | — | one file or archive (zip, tar.gz) | — |
| huggingface | Hub search API | Parquet files of a chosen subset and split | optional (gated sets) |
| kaggle | Kaggle API | dataset archive | the user's Kaggle token |
| openml | OpenML API | dataset as Parquet | — |
| uci | UCI repository API | dataset archive | — |

Later: data.gov and other open data portals, Wikipedia and Wikimedia dumps, Common Voice, LibriSpeech, Open Images, COCO, GitHub repositories, web crawl (robots.txt respected).

### 7.4 Seed list

D1 build: 27 well-known sets, each checked on Hugging Face (2026-10-16), for example: IMDB reviews, AG News, SST-2, Dolly 15k, Alpaca-cleaned, OpenAssistant, Iris, Titanic, Adult income, California housing, MNIST, Fashion-MNIST, CIFAR-10, Oxford-IIIT Pets, Food-101, Speech Commands, ESC-50, LibriSpeech (clean subset). Stored in `src/catalogue/seed.json`, with licences checked by hand.

## 8. AI assistance

### 8.1 Models

- Providers: the same as continuum-brain's `packages/models` (`ollama`, `anthropic`, `openai`, `opencode`, `compat`), with ids `provider/name`. The provider logic is copied into `src/ai/`, as plain JS, so the module does not depend on the brain repository.
- New calls: `generate(cfg, modelId, messages, { schema, maxTokens })`, returning text or JSON matching a schema, and `embed(cfg, modelId, texts)`.
- OpenAI-compatible `/chat/completions` covers ollama (at `/v1`), openai, opencode and compat; Anthropic uses the Messages API.
- The user chooses the model in settings. The default is a local Ollama model when one is running, so a student needs no paid key.
- The UI says plainly, before any row leaves the machine, when the chosen model is a cloud provider.

### 8.2 AI inside runner ops

Runner ops (`label`, `synthesise`, `augment` for text) call a small local proxy the worker starts for the run. It holds the key, enforces the run's token budget and records usage. The runner never sees the key.

### 8.3 Uses

| Use | Where | Output |
|---|---|---|
| Plan from a goal | Guided mode | `{ modality, task, labels, sources: [ranked], recipe }`, checked against the catalogue so it only names real sources. |
| Column mapping | ingest | Which column is the input, the label, the transcript. |
| Explain | everywhere | A plain-words explanation of a finding, suited to a beginner. |
| Label | `label` op | A label and confidence per row; rows below the threshold (0.7 by default) go to the review queue. |
| Find label errors | `find_label_errors` op | Rows whose label disagrees with the model (embeddings plus a judge). |
| Synthesise | `synthesise` op | New rows for small labels, marked `_source: synthetic`, kept out of the test split. |
| Card | `card` op | The card's prose. |
| Assistant | Inspector | Chat about the current dataset, which can propose steps (the user accepts them). |

## 9. Safety, licences and limits

### 9.1 Safety

- The content safety filter and PII redaction are on by default for every dataset.
- For accounts marked as under 18, the safety filter cannot be turned off and adult sources are hidden in the catalogue. See Q3.
- Sources flagged as adult or unsafe by their connector (for example Hugging Face's `not-for-all-audiences` tag) are hidden by default.

### 9.2 Data licences

- Each source's licence is shown before fetching, in plain words ("you may use this for anything if you credit the author").
- Unknown licences are allowed, but marked, and they fail the "Licences known" gate.
- Combining licences that conflict (for example non-commercial with a commercial goal the user stated) is a warning in validate.

### 9.3 Software licences

- The runner image uses only MIT, Apache-2.0, BSD and ISC packages, checked with the same rule as Deploy's `license-check.mjs`, extended to Python (`pip-licenses`). ffmpeg is built without GPL parts (LGPL), or audio decoding uses `soundfile` and `audioread` only. See Q4.
- No library needed by Phase 1 is GPL or AGPL.

### 9.4 Limits

| Limit | Default |
|---|---|
| Disk per user | 20 GB |
| Single upload | 5 GB |
| Runs at once per user | 2 |
| AI tokens per run | 500,000 (local Ollama: no limit) |

Admins (Continuum owners) can change limits per user.

## 10. UI screens

### 10.1 Placement

- A new console screen in `continuum-bridge-spine/src/screens/registry.jsx`: `{ id: "data", path: "/data", label: "Data", switcher: true }`, with a `DataProvider` (in `ScreenProviders.jsx`) so state survives switching screens, and `/data` added to `RESTORABLE_PATHS`.
- Shown only when `VITE_DATA_ENABLED` is set.
- Colours only from `theme/tokens.css`; `npm run check:colors` must pass. Small screens use the existing ☰ pane switching.

### 10.2 Left pane: Library

- **Datasets**: each dataset with its versions (number, rows, quality score, published badge).
- **Sources**: catalogue search with filters (data type, task, licence, size), source cards with a "Use this" button.
- **Recipes**: templates and the user's own.

### 10.3 Centre pane: Workbench

- **Guided mode** (the default for a new user):
  1. "What do you want your model to do?" (a text box with examples).
  2. The AI's plan: data type, labels, two to five sources with licences and sizes, the steps. Everything can be changed.
  3. Build: one card per step, showing progress and what it did ("Removed 1,204 near-copies").
  4. Result: the quality score, gates, a sample of rows, and "Download" or "Publish".
- **Pipeline mode**: the step list, add, remove, reorder (drag), turn steps on and off, edit settings; run from any step. Each finished step shows a before-and-after: rows, profile change, a sample of removed rows.
- **Data viewer**: a virtualised table for text and tabular data; a grid for images (labels and boxes drawn over); a list for audio (waveform, player, transcript). Filter by split, label, flag; search text.

### 10.4 Right pane: Inspector

Tabs: **Step** (settings of the chosen step), **Profile** (charts, following the dataviz rules), **Quality** (score and gates), **Run** (live log), **Review** (the review queue, one row at a time, with keyboard shortcuts), **Assistant** (AI chat).

### 10.5 Settings

Under the profile menu's Settings: model choice, provider keys, Hugging Face and Kaggle tokens, safety defaults, disk usage.

## 11. Build phases and acceptance criteria

### 11.1 Phases

| Phase | Delivers |
|---|---|
| D1 Foundation | Module mounted at `/data`; store, queue, worker; Docker runner driver; local storage; runner image with `fetch`, `ingest` (text, tabular), `profile`; upload and Hugging Face connectors; seed catalogue; UI: Library, data viewer (table), Profile tab. |
| D2 Text and tabular pipeline | dedupe, filter, tabular cleaning, redact_pii, text safety, balance, to_chat, split, validate, export, card, publish; recipes and templates; runs with SSE; Pipeline mode; version diffs; Kaggle, OpenML, UCI, URL connectors. |
| D3 Images and audio | Media ingest and profile; image and audio dedupe, repair, resize, resample, augment; image safety; image grid and audio viewers. |
| D4 AI assist | generate and embed; Guided mode; column mapping; label and review queue; find_label_errors; synthesise; AI cards; explanations; Assistant tab; model settings. |
| D5 Catalogue and brain | Catalogue growth and refresh; more connectors; licence-conflict checks; brain MCP tools over `/service/data`. |
| D6 Ready to split out | Own `server.js` with SSO; S3 and GCS storage drivers; runner in the user's cloud; per-user quotas UI. |

### 11.2 D1 acceptance criteria

1. With `DATA_ENABLED` unset, continuum-api starts as before and the Data screen is hidden.
2. With it set, continuum-api creates the continuum_data collections and indexes, and the worker claims jobs.
3. A user uploads a 50 MB CSV; it is ingested to Parquet, with `_id`, `_source` and `_licence` on every row, and shown in the viewer within 60 seconds.
4. A user picks `stanfordnlp/imdb` from the catalogue; its train split is fetched, ingested and profiled; the profile shows label balance and length distribution.
5. Another user cannot list, read or download the first user's datasets, versions, rows or media (tested through every route).
6. Killing continuum-api in the middle of a step: on restart, the job's lease expires, the step is retried, and exactly one output version is written.
7. A runner container has no access to MongoDB, continuum-api or another user's folder (tested).
8. No import from `continuum-api/src` exists in `continuum-data/src` (a test checks this).
9. `node --test` passes for the module; the runner image builds; its licence check passes; `npm run check:colors` passes.

### 11.3 D2 acceptance criteria (D2a and D2b, built 2026-10-16)

1. Every clean-up step writes a new version with `changes.json`; a pipeline makes one version per step, each made from the one before, and a crash mid-step still gives exactly one version per step.
2. IMDB (train, 25,000 rows): removing copies takes out the 96 exact copies and finds near copies; the split is 80/10/10 with the same label mix on each side and no copy on both sides; the quality score is 100.
3. SMS spam with the "Clean text for a classifier" template: phone numbers and emails are replaced with markers before copies are removed; 12-digit phone numbers are not mistaken for Aadhaar numbers (Verhoeff check); "xxx" (kisses) is not counted as unsafe.
4. The Hugging Face download loads with `pyarrow` per split and carries a README with what's in it, its sources and licences, how each version was made, and the quality checks.
5. Settings are checked against the step catalogue: an unknown step or setting, or shares that don't add up to 1, are refused with a plain message.
6. Another user can't run, see, export or download anything of yours (tested on every new route).
7. The privacy and safety steps are in every suggestion and text template (spec 9.1).

D2 build notes:
- The dataset card is written into every download's README by `export`, from details the engine passes in, rather than by a separate `card` step.
- Near copies are found with MinHash in polars, without `datasketch`.
- The safety step is a word list until the AI checks of D4.

### 11.4 D2c acceptance criteria (built 2026-10-16)

1. Sources from OpenML, UCI, Kaggle and any https link can be searched (Kaggle only with the user's token) and added by pasting their page's link; plain links stay private to whoever added them.
2. Archives are unpacked safely: paths that leave the folder are refused, links skipped, and size and file count capped.
3. A link that resolves to a private address is refused by the runner, also after a redirect.
4. Tokens are sealed (AES-256-GCM, `DATA_SECRET_KEY`). The UI shows only their last four characters. A run records which token it needs, but never the token, and no event or log line carries it.

D2c build note: OpenML, UCI and Kaggle couldn't be reached from the development network on 2026-10-16. Their connectors are tested against recorded answers in the shape of each documented API, and still need a live check.

The criteria for D3 to D6 are written when each phase starts.

## 12. Questions for the owner

| # | Question | Proposal |
|---|---|---|
| Q1 | continuum-api needs to start runner containers. Give its container the Docker socket, or add a small proxy that can only start continuum-data-runner containers? | The small proxy, because the socket gives full control of the host. **Accepted.** |
| Q2 | Should datasets be linked to Continuum projects (for example a Data tab in a project) from D1, or stay separate until the training engine exists? | Optional link from D1 (`projectId`), with no project UI until training. **Accepted.** |
| Q3 | Continuum accounts have no age. How should "under 18" be known for the locked safety filter? | An optional "This account is for a student" setting, which an admin or the user turns on, plus the safety filter on by default for everyone. **Accepted** (built with the safety filter, D2). |
| Q4 | Audio decoding: ship an LGPL-only ffmpeg build in the runner (allowed by exception), or decode only WAV, FLAC and OGG without ffmpeg? | LGPL ffmpeg by exception, recorded in the licence exceptions file, so MP3 and M4A work. **Accepted** (D3). |
| Q5 | Disk and AI limits in Section 9.4: are these defaults right for the host? | As written, to be changed after D1. **Accepted.** |
| Q6 | GPU: should the runner use a GPU when the host has one (for faster AI labelling and safety models)? | Not in D1 to D3; optional from D4. **Accepted.** |
