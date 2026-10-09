# Vidme 🎬

Self-hosted video streaming, cataloging, and automated processing service built on Node.js (Express), Alpine Docker, and FFmpeg.

---

## 🌟 Key Features

- **Modern SPA Frontend (v2.9.1):**
  - Single-page architecture with seamless client-side routing (`/v/:id`, `/library/*`).
  - Single-card responsive Hero Carousel with synchronized indicators for recent uploads.
  - Multi-tier browsing: Pinned videos, Suggested sections, and paginated full catalog.
  - Native video preview on hover (AV1 montage) and instant storyboard tiles.

- **Resumable TUS Upload Engine:**
  - Robust chunked upload via `@tus/server` and native Service Worker client.
  - Zero-bandwidth pre-detection: rejects non-H.264 formats client-side via binary header probing before uploading.
  - Automatic background resume via IndexedDB across network drops.

- **FFmpeg Processing Pipeline:**
  - Fast-start stream copy remuxing (`-c copy -movflags +faststart`).
  - High-performance Storyboard generation (2x2 grid preview).
  - Microclip montage generator (`.clip.webm` via `libsvtav1`) for instant hover scrub.
  - 3-artifact storage lifecycle: raw uploads in staging are automatically cleaned up after successful remuxing.

- **SQLite Database Architecture:**
  - Fast, self-contained embedded database using `better-sqlite3`.
  - WAL (Write-Ahead Logging) enabled with `busy_timeout` handling for concurrent reads/writes.
  - Automatic migration on startup (`db/sqlite.js`).
  - Clean schema template provided in `db/schema.sql` and `db/vidme.template.sqlite`.

- **WebDAV Ingestion:**
  - Integrated WebDAV server (`/webdav/*`) with Basic Auth for automated uploads and batch imports.

---

## 🏗️ Architecture & Storage Layout

| Container Path | Host Mode | Description |
|---|---|---|
| `/storage` | `rw` | Persistent volume for `vidme.sqlite`, `transcoded/`, `storyboard/`, `clip/` |
| `/import/sementara` | `ro` | Optional read-only import mount (e.g. Nextcloud inbox) |
| `/app/server.js` | `ro` | Express server backend |
| `/app/frontend` | `ro` | Client SPA files (HTML, CSS, Service Worker) |
| `/app/db` | `ro` | SQLite database connectors & schema template |

---

## 🚀 Getting Started

### Prerequisites
- Docker & Docker Compose
- Port `4100` available on host

### Deployment via Docker Compose

```yaml
services:
  vidme:
    image: vidme:latest
    build: .
    container_name: vidme
    environment:
      TZ: Asia/Jakarta
      STORAGE_PATH: /storage
      PORT: 4100
      NODE_ENV: production
      WEBDAV_USER: vidme
      WEBDAV_PASS: secretpassword
    ports:
      - 4100:4100
    volumes:
      - ./storage:/storage
      - ./server.js:/app/server.js:ro
      - ./logger.js:/app/logger.js:ro
      - ./frontend:/app/frontend:ro
      - ./db:/app/db:ro
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped
```

### Build & Run
```bash
docker compose build
docker compose up -d
```

Access the web interface at `http://localhost:4100`.

---

## ⚙️ Environment Variables

- `PORT` (default: `4100`): Port to bind HTTP service.
- `STORAGE_PATH` (default: `/storage`): Base directory for database and video artifacts.
- `NODE_ENV` (default: `production`): Node.js environment mode.
- `WEBDAV_USER`: Username for WebDAV authentication.
- `WEBDAV_PASS`: Password for WebDAV authentication.
