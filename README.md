# Vidme 🎬

Self-hosted video streaming, cataloging, and automated processing service built on Node.js (Express), Alpine Docker, and FFmpeg.

---

## 📁 Project Structure

```text
vidme/
├── backend/                      # Server application & processing pipeline
│   ├── db/
│   │   ├── schema.sql            # Database schema DDL
│   │   ├── sqlite.js             # Database connector & migrations
│   │   └── vidme.template.sqlite # Pre-initialized empty SQLite template
│   ├── backfill.mjs              # Metadata batch processor
│   ├── import.js                 # Media import utility
│   ├── logger.js                 # Custom logging engine
│   ├── reprobe.js                # Video metadata reprobing
│   └── server.js                 # Express monolith (TUS + FFmpeg)
│
├── frontend/                     # SPA Web Interface (v2.9.1)
│   ├── index.html                # Main SPA shell (Carousel, Grid, Paging)
│   ├── input.css                 # Tailwind input styles
│   ├── manifest.json             # PWA metadata
│   ├── material-symbols.woff2    # Icons font asset
│   ├── player.html               # Legacy fallback player
│   ├── service-worker.js         # TUS upload client & cache engine
│   └── tailwind.css              # Compiled Tailwind styles
│
├── docker/                       # Container configuration
│   ├── Dockerfile                # Production Alpine Node+FFmpeg image
│   ├── docker-compose.yml        # Service stack deployment
│   └── .dockerignore             # Docker build ignore rules
│
├── .gitignore                    # Git ignore rules
├── package.json                  # Root npm project definition
├── package-lock.json             # Dependency lockfile
└── README.md                     # Documentation
```

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
  - Automatic migration on startup (`backend/db/sqlite.js`).
  - Clean schema template provided in `backend/db/schema.sql` and `backend/db/vidme.template.sqlite`.

- **WebDAV Ingestion:**
  - Integrated WebDAV server (`/webdav/*`) with Basic Auth for automated uploads and batch imports.

---

## 🚀 Deployment via Docker Compose

Run from project root:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Access the web interface at `http://localhost:4100`.
