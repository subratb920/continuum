# continuum-directory-app: the Directory's page (port 45194, locally and in the cloud).
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Built here, once, with a placeholder for each VITE_ setting (scripts/runtime-env.mjs)
RUN node scripts/runtime-env.mjs build

EXPOSE 45194

# Locally (docker-compose): the Vite dev server. In the cloud (SERVE=built): the
# settings this container is given (VITE_API_BASE_URL, VITE_CONTINUUM_URL) go in
# place of the placeholders, then the built files are served on $PORT.
CMD ["sh", "-c", "if [ \"$SERVE\" = built ]; then node scripts/runtime-env.mjs apply && exec npx vite preview --host 0.0.0.0 --port \"${PORT:-45194}\" --strictPort; else exec npm run dev -- --host; fi"]
