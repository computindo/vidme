const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const logger = require("../logger");

const storagePath = process.env.STORAGE_PATH || "/storage";
fs.mkdirSync(storagePath, { recursive: true });
const db = new Database(path.join(storagePath, "vidme.sqlite"));
db.pragma("foreign_keys = ON");
// 18-09-26: WAL + busy_timeout — multiple writers (server + regen worker + future SSE reads)
// tanpa "database is locked". WAL = reader tidak blokir writer (penting utk polling grid).
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");
logger.info('DB', 'Initialized');

db.exec(`
CREATE TABLE IF NOT EXISTS folders (
id TEXT PRIMARY KEY,
name TEXT NOT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS videos (
id TEXT PRIMARY KEY,
title TEXT NOT NULL,
filename TEXT NOT NULL,
folder_id TEXT REFERENCES folders(id),
duration INTEGER,
size_bytes INTEGER,
width INTEGER,
height INTEGER,
is_portrait BOOLEAN DEFAULT 0,
is_pinned BOOLEAN DEFAULT 0,
status TEXT DEFAULT 'processing',
has_480p BOOLEAN DEFAULT 0,
has_360p BOOLEAN DEFAULT 0,
has_storyboard BOOLEAN DEFAULT 0,
has_microclip BOOLEAN DEFAULT 0,
fps REAL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

const cols = db.pragma("table_info(videos)").map(c => c.name);
if (!cols.includes("is_pinned")) {
  db.exec("ALTER TABLE videos ADD COLUMN is_pinned BOOLEAN DEFAULT 0");
  logger.info('DB', 'Migration: added column is_pinned');
}

for (const col of ['has_storyboard', 'has_microclip']) {
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE videos ADD COLUMN ${col} BOOLEAN DEFAULT 0`);
    logger.info('DB', `Migration: added column ${col}`);
  }
}
if (!cols.includes('fps')) {
  db.exec('ALTER TABLE videos ADD COLUMN fps REAL');
  logger.info('DB', 'Migration: added column fps');
}

const folderCols = db.pragma("table_info(folders)").map(c => c.name);
if (!folderCols.includes("parent_id")) {
  db.exec("ALTER TABLE folders ADD COLUMN parent_id TEXT REFERENCES folders(id)");
  logger.info('DB', 'Migration: added column parent_id');
}

module.exports = db;
