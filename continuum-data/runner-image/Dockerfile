# continuum-data-runner: runs one pipeline step as `cdata <op>`.
# Runs as uid 1000 with a read-only root file system, a tmpfs at /tmp and the
# user's store mounted at /store (see docs/runner-contract.md).
FROM python:3.12.15-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/tmp \
    TMPDIR=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    POLARS_TEMP_DIR=/tmp \
    CDATA_STORE=/store \
    CDATA_LICENCE_EXCEPTIONS=/opt/cdata/licence-exceptions.json

RUN groupadd --gid 1000 runner \
 && useradd --uid 1000 --gid 1000 --home-dir /home/runner --create-home --shell /usr/sbin/nologin runner \
 && mkdir -p /store /opt/cdata \
 && chown runner:runner /store

# Dependencies first (cached layer), pinned exactly.
# A local wheels/ folder (gitignored) is used instead of PyPI when present, for
# slow or offline networks: python3 tools/wheels.py wheels manylinux <pins>
COPY requirements.txt /opt/cdata/requirements.txt
COPY wheels /tmp/wheels
RUN if ls /tmp/wheels/*.whl >/dev/null 2>&1; then \
      pip install --no-cache-dir --no-index --find-links /tmp/wheels -r /opt/cdata/requirements.txt; \
    else \
      pip install --no-cache-dir --retries 10 --timeout 60 -r /opt/cdata/requirements.txt; \
    fi \
 && rm -rf /tmp/wheels

# The cdata package itself, copied in (no build step, so no network needed)
COPY cdata /opt/cdata/cdata
RUN printf '#!/bin/sh\nexec python -m cdata "$@"\n' > /usr/local/bin/cdata \
 && chmod 755 /usr/local/bin/cdata \
 && python -m compileall -q /opt/cdata/cdata
ENV PYTHONPATH=/opt/cdata

COPY licence-exceptions.json /opt/cdata/licence-exceptions.json

USER 1000:1000
WORKDIR /home/runner

# No ENTRYPOINT: the worker runs `docker run IMAGE cdata <op>`.
CMD ["cdata", "--help"]
