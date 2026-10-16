# continuum-data-runner

The Python image that runs one continuum-data pipeline step as `cdata <op>`
(`fetch`, `ingest`, `profile`, `licences`). The contract is
[`../docs/runner-contract.md`](../docs/runner-contract.md).

## Build

```sh
docker build -t continuum-data-runner:dev .
```

On a slow or offline network, put the pinned wheels (Linux, for the image's
architecture) in `wheels/` first; the build then installs from there and
never asks PyPI (`wheels/*.whl` is gitignored):

```sh
python3 tools/wheels.py wheels manylinux_2_17_aarch64,manylinux_2_28_aarch64 $(cat requirements.txt)
```

## Run a step

```sh
docker run --rm --read-only --tmpfs /tmp --network none --user 1000:1000 \
  -v "$STORE/$USER_ID":/store \
  -e CDATA_PARAMS='{"input":"raw/r1","output":"datasets/d1/v1","sourceId":"ab12","licence":"cc-by-4.0"}' \
  continuum-data-runner:dev cdata ingest

docker run --rm continuum-data-runner:dev cdata licences
```

`fetch` is the only op that needs `--network` (leave out `--network none`).

## Test

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt pytest==9.1.1
.venv/bin/python -m pytest -q
```

Or inside the image (no local Python packages needed; put pytest and its
wheels in a folder first):

```sh
docker run --rm -u 0 -v "$PWD:/t:ro" -v "$WHEELS:/w:ro" -w /t continuum-data-runner:dev \
  sh -c 'pip install -q --no-index --find-links /w pytest==9.1.1 && python -m pytest -q -p no:cacheprovider'
```

The tests run the CLI as a subprocess with `CDATA_STORE` pointing at a temp
folder (the default store root is `/store`).

## Settings (environment)

| Variable | Default | Meaning |
|---|---|---|
| `CDATA_PARAMS` | – | The op's parameters, as JSON. |
| `CDATA_STORE` | `/store` | Root that every parameter path is relative to. |
| `CDATA_LICENCE_EXCEPTIONS` | `/opt/cdata/licence-exceptions.json` | Allowed licence exceptions. |
| `CDATA_BATCH_ROWS` | `50000` | Rows read per batch. |
| `CDATA_PART_ROWS` | `200000` | Rows per Parquet part. |
| `CDATA_FETCH_BACKOFF` | `2` | First retry wait in seconds (doubles each retry). |
| `CDATA_FETCH_TIMEOUT` | `60` | Socket timeout in seconds. |

Dependencies are pinned in `requirements.txt`; `cdata licences` fails the
build check when an installed package is not MIT, Apache-2.0, BSD, ISC, PSF
(or MPL-2.0 for certifi) and not listed in `licence-exceptions.json`.
