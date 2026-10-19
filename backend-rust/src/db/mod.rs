pub mod folders;
pub mod models;
pub mod videos;

use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, SqlitePool};
use std::str::FromStr;
use std::time::Duration;

pub async fn init_pool(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_millis(5000))
        .foreign_keys(true);

    let pool = SqlitePool::connect_with(options).await?;
    init_tables(&pool).await?;
    Ok(pool)
}

async fn init_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            filename TEXT NOT NULL,
            duration INTEGER,
            width INTEGER,
            height INTEGER,
            is_portrait INTEGER DEFAULT 0,
            fps REAL,
            codec TEXT,
            folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
            is_pinned INTEGER DEFAULT 0,
            has_storyboard INTEGER DEFAULT 0,
            has_microclip INTEGER DEFAULT 0,
            status TEXT DEFAULT 'processing',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        "#
    )
    .execute(pool)
    .await?;

    // Defensive migrations for pre-existing tables if any columns missing
    let _ = sqlx::query("ALTER TABLE videos ADD COLUMN is_pinned INTEGER DEFAULT 0").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE videos ADD COLUMN has_storyboard INTEGER DEFAULT 0").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE videos ADD COLUMN has_microclip INTEGER DEFAULT 0").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE videos ADD COLUMN fps REAL").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE folders ADD COLUMN parent_id TEXT").execute(pool).await;

    Ok(())
}
