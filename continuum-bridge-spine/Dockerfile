FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# The UI is built here, once, with a placeholder for each VITE_ setting
# (scripts/runtime-env.mjs): Cloud Build has the memory a build needs.
RUN node scripts/runtime-env.mjs build

EXPOSE 5173

# Locally (docker-compose): the Vite dev server, as before.
# In the cloud (SERVE=built): the settings this container is given (e.g.
# VITE_API_BASE_URL) are put in place of the placeholders, then the built
# files are served on $PORT. A second or two, and little memory.
CMD ["sh", "-c", "if [ \"$SERVE\" = built ]; then node scripts/runtime-env.mjs apply && exec npx vite preview --host 0.0.0.0 --port \"${PORT:-8080}\" --strictPort; else exec npm run dev -- --host; fi"]
