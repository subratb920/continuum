FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

# Locally (docker-compose): the Vite dev server, as before.
# In the cloud (SERVE=built): build with the settings the container is given
# (VITE_API_BASE_URL is read at build time, so the build happens at start),
# then serve the built files on $PORT.
CMD ["sh", "-c", "if [ \"$SERVE\" = built ]; then npm run build && exec npx vite preview --host 0.0.0.0 --port \"${PORT:-8080}\" --strictPort; else exec npm run dev -- --host; fi"]
