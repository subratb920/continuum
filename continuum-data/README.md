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

## Tests

- Engine: `npm test` (needs Continuum's local MongoDB on port 45171, or `TEST_MONGO_URI`). Each test file uses a database of its own and drops it.
- Proxy: `cd runner-proxy && npm test`
- Runner: see [runner-image/README.md](runner-image/README.md).

## Licence

Private and proprietary, as the rest of Continuum.
