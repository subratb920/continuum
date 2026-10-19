# The workspace: OpenVSCode Server (MIT, gitpod-io/openvscode-server) with the
# tools Continuum's starter projects use. One container per running workspace;
# /home/workspace is the workspace's own volume (code, settings, extensions).
#
# Sandboxes, one build target each (the last, full, is the default):
#   docker build --target node   -t continuum-workspace-node:dev   .   Node 22
#   docker build --target python -t continuum-workspace-python:dev .   Python 3
#   docker build --target java   -t continuum-workspace-java:dev   .   Java 21 and Maven
#   docker build                 -t continuum-workspace:dev        .   all of them
FROM node:22.20.0-bookworm-slim AS node-dist

# The editor and how a workspace starts, shared by every sandbox
FROM gitpod/openvscode-server:1.105.1 AS base
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY start.sh /usr/local/bin/continuum-workspace-start
RUN chmod 755 /usr/local/bin/continuum-workspace-start

FROM base AS node
COPY --from=node-dist /usr/local/bin/node /usr/local/bin/node
COPY --from=node-dist /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack
USER openvscode-server
ENTRYPOINT ["/usr/local/bin/continuum-workspace-start"]

FROM base AS python
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
 && rm -rf /var/lib/apt/lists/*
USER openvscode-server
ENTRYPOINT ["/usr/local/bin/continuum-workspace-start"]

FROM base AS java
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jdk-headless maven \
 && rm -rf /var/lib/apt/lists/*
USER openvscode-server
ENTRYPOINT ["/usr/local/bin/continuum-workspace-start"]

# Python and Java from the distribution; Node from its official image
FROM base AS full
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip openjdk-21-jdk-headless maven \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node-dist /usr/local/bin/node /usr/local/bin/node
COPY --from=node-dist /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack
USER openvscode-server
ENTRYPOINT ["/usr/local/bin/continuum-workspace-start"]
