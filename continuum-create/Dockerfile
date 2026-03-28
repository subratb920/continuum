FROM node:18-bullseye-slim

WORKDIR /app

# 1. Install build tools for native modules (isolated-vm, better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 g++ make libsqlite3-dev git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable
RUN corepack prepare yarn@4.4.1 --activate

# 2. Copy only dependency files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY packages packages

# 3. Clean install to build Linux-ARM64 native modules
# We ignore checksums to bypass the 'hunk' error we saw earlier
RUN YARN_CHECKSUM_BEHAVIOR=ignore yarn install --no-immutable

# 4. Copy the rest and the bundle you built on your Mac
COPY packages/backend/dist/bundle.tar.gz .
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz
COPY app-config.yaml ./

ENV NODE_ENV=development 
EXPOSE 7007

CMD ["node", "packages/backend", "--config", "app-config.yaml"]
