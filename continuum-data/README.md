# continuum-data

Continuum's data engineering engine: find data, download it, tidy it into one clean table, measure it, and (in coming phases) clean, improve, split and publish it, ready to train a model on. Made so that anyone, a school student included, can get from "I want a model that does X" to a good dataset.

Docs: [Phase 1 spec](docs/phase1-spec.md) · [Runner contract](docs/runner-contract.md)

## How it fits in

- **`src/`**: the engine (Node, plain JS). continuum-api loads it when `DATA_ENABLED=true` and mounts it at `/data` (`continuum-api/src/data/engine.js`). It has its own MongoDB database (`continuum_data`) and imports nothing from continuum-api, so it can move to a server of its own later (spec 1.5).
- **`runner-proxy/`**: continuum-data-runner-proxy, the only part holding Docker's socket. It can start only the runner image, with one user's folder as `/store`, no privileges and no network unless the step is a download.
- **`runner-image/`**: continuum-data-runner (Python): the `cdata` command, one op per pipeline step.
- **UI**: the Data screen in continuum-bridge-spine (`src/screens/data/`, `src/data/`), shown when `VITE_DATA_ENABLED=true`.

## Running it locally (Docker Compose)

1. Build the runner image: `docker build -t continuum-data-runner:dev continuum-data/runner-image`
2. Install the engine's packages: `cd continuum-data && npm ci`
3. In `docker/.env`, set `DATA_ENABLED=true`.
4. `cd docker && docker-compose up -d --build continuum-api continuum-ui continuum-data-runner-proxy`
5. Open Continuum and choose **Data** in the screen switcher.

Dataset files live in `~/.continuum/data-store/<userId>/`.

### Running continuum-api outside Docker

Start the proxy on the host (`cd continuum-data/runner-proxy && PROXY_TOKEN=… STORE_HOST_PATH=$HOME/.continuum/data-store npm start`), and put in continuum-api's `.env.local`:

```
DATA_ENABLED=true
DATA_STORE_PATH=/Users/<you>/.continuum/data-store
DATA_RUNNER_URL=http://localhost:45191
DATA_RUNNER_TOKEN=…   # the proxy's PROXY_TOKEN
```

## In the cloud (Kubernetes)

continuum-api's cloud image (`continuum-api/Dockerfile.cloud`, built from the repository root) carries the engine, and `continuum.deploy.json` at the repository root gives Continuum Deploy three apps: `data-runner` (this runner image, only built), `continuum-api` (with `clusterAccess: ["pods"]`) and the UI. With `DATA_RUNTIME=kubernetes` (`continuum-api/.env.production`) the engine sets up what it needs in its own namespace, on first start:

- **`data-store`**: a disk (PersistentVolumeClaim, `DATA_STORE_DISK_GB`, 50 GB) with every user's folder, and a small pod of the runner image serving it to continuum-api (`cdata/store_server.py`, token in the Secret `data-store`). continuum-api's own pods can't mount the disk, so it reads and writes through the store (`src/storage/remote.js`).
- **A pod per step** (`src/runtime/kubeRunner.js`): the runner image as uid 1000, read-only root, no privileges, no ServiceAccount token, only its user's folder as `/store`, on the store's machine (the disk is attached there). Its output is followed from the pod's log.
- **Network rules**: steps get no network; downloads (`fetch`) get the internet only, never the cluster, the machine or Google's metadata server.

Room: `continuum.infra.json` at the repository root asks Continuum Deploy for up to 16 vCPU, 48 GiB and 60 running pieces for the continuum project (two steps at 2 vCPU and 8 GiB each, plus the apps, the store and the database).

Settings: `DATA_RUNNER_IMAGE` (`${data-runner.image}`), `DATA_RUNNER_CPU` / `DATA_RUNNER_MEMORY` per step, `DATA_MONGO_URI` from Continuum Deploy's database (`continuum_data`), `DATA_SECRET_KEY` on the deploy page. Without a replica set the Data screen's live updates read new events every second instead of using a change stream.

## Tests

- Engine: `npm test` (needs Continuum's local MongoDB on port 45171, or `TEST_MONGO_URI`). Each test file uses a database of its own and drops it.
- Proxy: `cd runner-proxy && npm test`
- Runner: see [runner-image/README.md](runner-image/README.md).

## Licence

Private and proprietary, as the rest of Continuum.
