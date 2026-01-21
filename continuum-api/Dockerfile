FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Copy source
COPY . .

CMD ["node", "src/server.js"]