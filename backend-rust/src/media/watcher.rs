use crate::config::Config;
use crate::db;
use crate::media::{probe, worker::ProcessJob};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::{broadcast, mpsc};
use tokio::time::{sleep, Duration};
use uuid::Uuid;

const VIDEO_EXTENSIONS: &[&str] = &[".mp4", ".mov", ".avi", ".mkv", ".webm", ".ts"];

pub fn spawn_inbox_watcher(
    pool: SqlitePool,
    config: Arc<Config>,
    sse_tx: broadcast::Sender<String>,
    worker_tx: mpsc::Sender<ProcessJob>,
) {
    tokio::spawn(async move {
        let inbox_path = format!("{}/webdav-inbox", config.storage_path);
        let staging_dir = format!("{}/staging", config.storage_path);
        let _ = fs::create_dir_all(&inbox_path).await;
        let _ = fs::create_dir_all(&staging_dir).await;

        tracing::info!("WebDAV inbox watcher started at {}", inbox_path);

        loop {
            sleep(Duration::from_secs(3)).await;
            if let Ok(entries) = scan_inbox_recursive(&inbox_path).await {
                for file_path in entries {
                    if let Err(e) = process_inbox_file(
                        &pool,
                        &config,
                        &sse_tx,
                        &worker_tx,
                        &file_path,
                    )
                    .await
                    {
                        tracing::error!("Error processing inbox file {:?}: {}", file_path, e);
                    }
                }
            }
        }
    });
}

fn is_video_file(path: &Path) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let dot_ext = format!(".{}", ext.to_lowercase());
        VIDEO_EXTENSIONS.contains(&dot_ext.as_str())
    } else {
        false
    }
}

async fn scan_inbox_recursive(root: &str) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut results = Vec::new();
    let mut dirs_to_visit = vec![PathBuf::from(root)];

    while let Some(current_dir) = dirs_to_visit.pop() {
        if let Ok(mut read_dir) = fs::read_dir(&current_dir).await {
            while let Ok(Some(entry)) = read_dir.next_entry().await {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.starts_with('.') || file_name.ends_with(".folderid") {
                    continue;
                }
                let path = entry.path();
                if let Ok(meta) = entry.metadata().await {
                    if meta.is_dir() {
                        dirs_to_visit.push(path);
                    } else if meta.is_file() && is_video_file(&path) {
                        results.push(path);
                    }
                }
            }
        }
    }

    Ok(results)
}

async fn process_inbox_file(
    pool: &SqlitePool,
    config: &Config,
    sse_tx: &broadcast::Sender<String>,
    worker_tx: &mpsc::Sender<ProcessJob>,
    file_path: &Path,
) -> Result<(), String> {
    let meta1 = fs::metadata(file_path)
        .await
        .map_err(|e| format!("Cannot read metadata: {}", e))?;
    let len1 = meta1.len();
    if len1 < 1024 {
        return Ok(());
    }

    sleep(Duration::from_millis(1500)).await;
    let meta2 = fs::metadata(file_path)
        .await
        .map_err(|e| format!("Cannot read metadata after delay: {}", e))?;
    if meta2.len() != len1 {
        return Ok(());
    }

    let file_str = file_path.to_string_lossy().to_string();
    tracing::info!("WebDAV inbox file stable: {}", file_str);

    let probe_meta = match probe::probe_video(&file_str).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Rejecting inbox file {}: {}", file_str, e);
            let _ = fs::remove_file(file_path).await;
            return Ok(());
        }
    };

    let codec = probe_meta.codec.as_deref().unwrap_or("unknown");
    if !probe::is_codec_allowed(codec) {
        tracing::warn!("Rejecting non-H.264 video from inbox: {} ({})", file_str, codec);
        let _ = fs::remove_file(file_path).await;
        return Ok(());
    }

    let title = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled");

    let sidecar_path = format!("{}.folderid", file_str);
    let folder_id = if fs::try_exists(&sidecar_path).await.unwrap_or(false) {
        let content = fs::read_to_string(&sidecar_path).await.unwrap_or_default();
        let _ = fs::remove_file(&sidecar_path).await;
        let trimmed = content.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    } else {
        None
    };

    let video_id = Uuid::new_v4().to_string();
    let staging_path = format!("{}/staging/{}.mp4", config.storage_path, video_id);

    fs::rename(file_path, &staging_path)
        .await
        .map_err(|e| format!("Failed to move inbox file to staging: {}", e))?;

    let filename = format!("{}.mp4", video_id);
    db::videos::insert_video(
        pool,
        &video_id,
        title,
        &filename,
        folder_id.as_deref(),
        len1 as i64,
    )
    .await
    .map_err(|e| format!("Failed to insert video to DB: {}", e))?;

    if let Ok(Some(video)) = db::videos::get_video(pool, &video_id).await {
        let sse_msg = serde_json::json!({
            "type": "video",
            "video": video
        });
        let _ = sse_tx.send(sse_msg.to_string());
    }

    let _ = worker_tx
        .send(ProcessJob {
            video_id,
            staging_path,
        })
        .await;

    Ok(())
}
