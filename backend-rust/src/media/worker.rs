use crate::config::Config;
use crate::db;
use crate::media::{ffmpeg, probe};
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

#[derive(Debug, Clone)]
pub struct ProcessJob {
    pub video_id: String,
    pub staging_path: String,
}

pub fn spawn_media_worker(
    pool: SqlitePool,
    config: Arc<Config>,
    sse_tx: broadcast::Sender<String>,
    mut rx: mpsc::Receiver<ProcessJob>,
) {
    tokio::spawn(async move {
        tracing::info!("Media worker loop started");
        while let Some(job) = rx.recv().await {
            tracing::info!("Processing video job: {}", job.video_id);
            if let Err(e) = process_single_video(&pool, &config, &sse_tx, &job).await {
                tracing::error!("Error processing video {}: {}", job.video_id, e);
            }
        }
    });
}

async fn process_single_video(
    pool: &SqlitePool,
    config: &Config,
    sse_tx: &broadcast::Sender<String>,
    job: &ProcessJob,
) -> Result<(), String> {
    let video_id = &job.video_id;
    let staging_path = &job.staging_path;

    let transcoded_dir = format!("{}/transcoded", config.storage_path);
    let thumbnails_dir = format!("{}/thumbnails", config.storage_path);

    let _ = tokio::fs::create_dir_all(&transcoded_dir).await;
    let _ = tokio::fs::create_dir_all(&thumbnails_dir).await;

    let transcoded_path = format!("{}/{}.mp4", transcoded_dir, video_id);
    let thumb_path = format!("{}/{}.jpg", thumbnails_dir, video_id);
    let storyboard_path = format!("{}/{}.storyboard.jpg", thumbnails_dir, video_id);
    let clip_path = format!("{}/{}.clip.webm", thumbnails_dir, video_id);

    // 1. Probe staging video
    let meta = match probe::probe_video(staging_path).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Failed to probe staging video {}: {}", video_id, e);
            crate::db::models::VideoMeta::default()
        }
    };

    let dur = meta.duration.unwrap_or(0);
    let is_portrait = meta.is_portrait;

    let _ = db::videos::update_video_metadata(pool, video_id, &meta).await;

    // 2. Extract initial thumbnail
    if let Err(e) = ffmpeg::extract_thumbnail(staging_path, &thumb_path, is_portrait).await {
        tracing::warn!("Initial thumbnail extraction failed for {}: {}", video_id, e);
    }

    // 3. Remux to transcoded with +faststart
    let remux_res = ffmpeg::transcode_remux(staging_path, &transcoded_path).await;
    match remux_res {
        Ok(()) => {
            let file_size = tokio::fs::metadata(&transcoded_path)
                .await
                .map(|m| m.len() as i64)
                .unwrap_or(0);

            let _ = db::videos::update_video_status(pool, video_id, "ready", Some(file_size)).await;

            // 3-artifact policy: hapus staging segera setelah remux sukses
            let _ = tokio::fs::remove_file(staging_path).await;

            broadcast_video_update(pool, sse_tx, video_id).await;
        }
        Err(e) => {
            tracing::error!("Remux failed for {}: {}", video_id, e);
            let _ = db::videos::update_video_status(pool, video_id, "error", None).await;
            broadcast_video_update(pool, sse_tx, video_id).await;
            return Err(e);
        }
    }

    // 4. Serial preview queue: Storyboard DULU, baru Microclip
    tracing::info!("Generating storyboard for {}", video_id);
    match ffmpeg::generate_storyboard(&transcoded_path, &storyboard_path, dur, is_portrait).await {
        Ok(true) => {
            let _ = db::videos::update_storyboard_status(pool, video_id, true).await;
            broadcast_video_update(pool, sse_tx, video_id).await;
            tracing::info!("Storyboard done for {}", video_id);
        }
        Ok(false) => {
            tracing::warn!("Storyboard skipped or empty for {}", video_id);
        }
        Err(e) => {
            tracing::error!("Storyboard failed for {}: {}", video_id, e);
        }
    }

    tracing::info!("Generating microclip for {}", video_id);
    match ffmpeg::generate_microclip(&transcoded_path, &clip_path, dur, is_portrait).await {
        Ok(true) => {
            let _ = db::videos::update_microclip_status(pool, video_id, true).await;
            broadcast_video_update(pool, sse_tx, video_id).await;
            tracing::info!("Microclip done for {}", video_id);
        }
        Ok(false) => {
            tracing::warn!("Microclip skipped for {}", video_id);
        }
        Err(e) => {
            tracing::error!("Microclip failed for {}: {}", video_id, e);
        }
    }

    Ok(())
}

async fn broadcast_video_update(
    pool: &SqlitePool,
    sse_tx: &broadcast::Sender<String>,
    video_id: &str,
) {
    if let Ok(Some(video)) = db::videos::get_video(pool, video_id).await {
        let payload = serde_json::json!({
            "type": "video",
            "video": video
        });
        let _ = sse_tx.send(payload.to_string());
    }
}
