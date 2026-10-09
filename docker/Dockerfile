FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV PORT=4100
ENV STORAGE_PATH=/storage
ENV NODE_ENV=production

EXPOSE 4100

CMD ["node", "backend/server.js"]
