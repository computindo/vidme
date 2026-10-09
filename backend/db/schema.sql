-- Vidme Database Schema (SQLite)
-- Initial table definitions for folders and video catalog

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id),
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
