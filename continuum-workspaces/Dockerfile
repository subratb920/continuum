# continuum-workspaces (the service, not a workspace): Node only, no packages
FROM node:22.20.0-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
# A normal user (the cloud: Kubernetes driver). Local development runs it as root
# only to use the Docker socket (docker-compose sets user: "0").
USER node
EXPOSE 45176 45177
CMD ["node", "src/main.js"]
