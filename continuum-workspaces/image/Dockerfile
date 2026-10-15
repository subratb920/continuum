# The workspace: OpenVSCode Server (MIT, gitpod-io/openvscode-server) with the
# tools Continuum's starter projects use. One container per running workspace;
# /home/workspace is the workspace's own volume (code, settings, extensions).
FROM node:22.20.0-bookworm-slim AS node

FROM gitpod/openvscode-server:1.105.1

USER root
# Python and Java from the distribution; Node from its official image
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip openjdk-21-jdk-headless maven curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

COPY start.sh /usr/local/bin/continuum-workspace-start
RUN chmod 755 /usr/local/bin/continuum-workspace-start
USER openvscode-server
ENTRYPOINT ["/usr/local/bin/continuum-workspace-start"]
