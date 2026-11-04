# Stage 0: Frontend Svelte 5 builder
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend-svelte
COPY frontend-svelte/package*.json ./
RUN npm install
COPY frontend-svelte/ ./
RUN npm run build

# Stage 1: Chef planner for Cargo dependency caching
FROM lukemathwalker/cargo-chef:latest-rust-alpine AS chef
WORKDIR /app

FROM chef AS planner
COPY backend-rust/Cargo.toml ./
# Buat dummy files untuk analisis dependensi library & binaries
RUN mkdir -p src src/bin \
    && echo "pub fn dummy() {}" > src/lib.rs \
    && echo "fn main() {}" > src/main.rs \
    && echo "fn main() {}" > src/bin/reprobe.rs
RUN cargo chef prepare --recipe-path recipe.json

# Stage 2: Builder - compile dependencies & binaries
FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Build dependencies only - ini akan di-cache oleh Docker
RUN cargo chef cook --release --recipe-path recipe.json

# Copy source code asli dan build binary
COPY backend-rust/ ./
RUN cargo build --release --bin vidme-backend --bin reprobe \
    && strip -s /app/target/release/vidme-backend /app/target/release/reprobe

# Stage 3: Runtime minimal image
FROM alpine:3.20 AS runtime

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy binaries backend Rust & CLI tools
COPY --from=builder /app/target/release/vidme-backend /usr/local/bin/vidme-backend
COPY --from=builder /app/target/release/reprobe /usr/local/bin/reprobe

# Copy minimal static FFmpeg & ffprobe dari ghcr.io/computindo/ffmpeg-mini
COPY --from=ghcr.io/computindo/ffmpeg-mini:latest /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ghcr.io/computindo/ffmpeg-mini:latest /usr/local/bin/ffprobe /usr/local/bin/ffprobe

# Copy frontend static files (built SPA Svelte 5)
COPY --from=frontend-builder /app/frontend-svelte/dist /app/frontend/

ENV PORT=4100
ENV STORAGE_PATH=/storage
ENV RUST_LOG=vidme_backend=info,tower_http=info

EXPOSE 4100

CMD ["/usr/local/bin/vidme-backend"]
