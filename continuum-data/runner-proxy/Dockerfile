FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
# Root only to use Docker's socket (local development), as continuum-workspaces
CMD ["node", "src/server.js"]
