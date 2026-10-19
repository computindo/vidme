use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
use crate::{
    db,
    media::{probe, worker::ProcessJob},
    state::AppState,
};

const TUS_VERSION: &str = "1.0.0";

#[derive(Serialize, Deserialize)]
struct TusUploadMeta {
    upload_length: u64,
    video_id: String,
    title: String,
    filename: String,
    folder_id: Option<String>,
}

fn parse_tus_metadata(header_val: &str) -> (String, Option<String>, String) {
    let mut filename = "upload.mp4".to_string();
    let mut title = "untitled".to_string();
    let mut folder_id = None;

    for part in header_val.split(',') {
        let mut kv = part.trim().splitn(2, ' ');
        if let (Some(k), Some(v_b64)) = (kv.next(), kv.next()) {
            if let Ok(decoded_bytes) =
                base64::engine::general_purpose::STANDARD.decode(v_b64.trim())
            {
                if let Ok(val) = String::from_utf8(decoded_bytes) {
                    match k {
                        "filename" | "name" => filename = val,
                        "title" => title = val,
                        "folderId" | "folder_id" => {
                            let t = val.trim();
                            if !t.is_empty() {
                                folder_id = Some(t.to_string());
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    if title == "untitled" && !filename.is_empty() {
        if let Some(stem) = std::path::Path::new(&filename)
            .file_stem()
            .and_then(|s| s.to_str())
        {
            title = stem.to_string();
        }
    }

    (filename, folder_id, title)
}

// POST /api/upload/tus - Create upload
pub async fn create_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, String)> {
    let upload_length = headers
        .get("upload-length")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or((StatusCode::BAD_REQUEST, "Missing Upload-Length header".to_string()))?;

    let upload_id = Uuid::new_v4().to_string();
    let chunk_dir = format!("{}/tus-chunks", state.config.storage_path);
    tokio::fs::create_dir_all(&chunk_dir)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let chunk_path = format!("{}/{}", chunk_dir, upload_id);
    let _ = File::create(&chunk_path)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (filename, folder_id, title) = if let Some(meta_header) = headers.get("upload-metadata") {
        if let Ok(meta_str) = meta_header.to_str() {
            parse_tus_metadata(meta_str)
        } else {
            ("upload.mp4".into(), None, "untitled".into())
        }
    } else {
        ("upload.mp4".into(), None, "untitled".into())
    };

    let video_id = Uuid::new_v4().to_string();
    let meta_obj = TusUploadMeta {
        upload_length,
        video_id,
        title,
        filename,
        folder_id,
    };

    let meta_json = serde_json::to_string(&meta_obj).unwrap_or_default();
    let meta_path = format!("{}/{}.meta", chunk_dir, upload_id);
    let _ = tokio::fs::write(&meta_path, meta_json).await;

    Ok(Response::builder()
        .status(StatusCode::CREATED)
        .header("Tus-Resumable", TUS_VERSION)
        .header(header::LOCATION, format!("/api/upload/tus/{}", upload_id))
        .header("Upload-Length", upload_length.to_string())
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Location, Tus-Resumable, Upload-Offset, Upload-Length",
        )
        .body(axum::body::Body::empty())
        .unwrap())
}

// HEAD /api/upload/tus/:id - Get upload offset for auto-resume
pub async fn get_upload_offset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let chunk_path = format!("{}/tus-chunks/{}", state.config.storage_path, id);
    let meta_path = format!("{}/tus-chunks/{}.meta", state.config.storage_path, id);
    let metadata = tokio::fs::metadata(&chunk_path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "Upload not found".to_string()))?;

    let offset = metadata.len();

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header("Tus-Resumable", TUS_VERSION)
        .header("Upload-Offset", offset.to_string())
        .header(header::CACHE_CONTROL, "no-store");

    if let Ok(meta_str) = tokio::fs::read_to_string(&meta_path).await {
        if let Ok(meta_info) = serde_json::from_str::<TusUploadMeta>(&meta_str) {
            builder = builder.header("Upload-Length", meta_info.upload_length.to_string());
        }
    }

    Ok(builder
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Upload-Offset, Upload-Length, Tus-Resumable",
        )
        .body(axum::body::Body::empty())
        .unwrap())
}

// PATCH /api/upload/tus/:id - Append binary chunk
pub async fn upload_chunk(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, (StatusCode, String)> {
    let client_offset = headers
        .get("upload-offset")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or((StatusCode::BAD_REQUEST, "Missing Upload-Offset header".to_string()))?;

    let chunk_dir = format!("{}/tus-chunks", state.config.storage_path);
    let chunk_path = format!("{}/{}", chunk_dir, id);
    let meta_path = format!("{}/{}.meta", chunk_dir, id);

    let current_meta = tokio::fs::metadata(&chunk_path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "Upload not found".to_string()))?;

    let current_offset = current_meta.len();
    if client_offset != current_offset {
        return Err((
            StatusCode::CONFLICT,
            format!(
                "Upload-Offset mismatch (client={}, server={})",
                client_offset, current_offset
            ),
        ));
    }

    let mut file = OpenOptions::new()
        .append(true)
        .open(&chunk_path)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    file.write_all(&body)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let new_offset = current_offset + body.len() as u64;

    // Cek apakah upload sudah lengkap
    let meta_str = tokio::fs::read_to_string(&meta_path).await.unwrap_or_default();
    if let Ok(meta_info) = serde_json::from_str::<TusUploadMeta>(&meta_str) {
        if new_offset >= meta_info.upload_length {
            tracing::info!(
                "TUS upload complete for: {} ({} bytes)",
                meta_info.title,
                new_offset
            );

            // Validasi Codec Gate H.264
            match probe::probe_video(&chunk_path).await {
                Ok(probe_meta) => {
                    let codec = probe_meta.codec.as_deref().unwrap_or("unknown");
                    if !probe::is_codec_allowed(codec) {
                        tracing::warn!("TUS upload rejected: non-H.264 codec ({})", codec);
                        let _ = tokio::fs::remove_file(&chunk_path).await;
                        let _ = tokio::fs::remove_file(&meta_path).await;
                        return Err((
                            StatusCode::UNPROCESSABLE_ENTITY,
                            format!("Only H.264 video is accepted (got: {}). Convert first, then re-upload.", codec),
                        ));
                    }
                }
                Err(e) => {
                    tracing::warn!("TUS upload probe failed: not a valid video ({})", e);
                    let _ = tokio::fs::remove_file(&chunk_path).await;
                    let _ = tokio::fs::remove_file(&meta_path).await;
                    return Err((
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Uploaded file is not a valid video".to_string(),
                    ));
                }
            }

            // Pindahkan chunk ke staging
            let staging_dir = format!("{}/staging", state.config.storage_path);
            let _ = tokio::fs::create_dir_all(&staging_dir).await;
            let staging_path = format!("{}/{}.mp4", staging_dir, meta_info.video_id);

            let _ = tokio::fs::rename(&chunk_path, &staging_path).await;
            let _ = tokio::fs::remove_file(&meta_path).await;

            // Insert DB
            let dest_filename = format!("{}.mp4", meta_info.video_id);
            if let Err(e) = db::videos::insert_video(
                &state.pool,
                &meta_info.video_id,
                &meta_info.title,
                &dest_filename,
                meta_info.folder_id.as_deref(),
                new_offset as i64,
            )
            .await
            {
                tracing::error!("Failed to insert video into DB: {}", e);
            } else {
                // Broadcast SSE event
                if let Ok(Some(video)) =
                    db::videos::get_video(&state.pool, &meta_info.video_id).await
                {
                    let sse_msg = serde_json::json!({
                        "type": "video",
                        "video": video
                    });
                    let _ = state.sse_tx.send(sse_msg.to_string());
                }

                // Dispatch ke media worker
                let _ = state
                    .worker_tx
                    .send(ProcessJob {
                        video_id: meta_info.video_id,
                        staging_path,
                    })
                    .await;
            }
        }
    }

    Ok(Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("Tus-Resumable", TUS_VERSION)
        .header("Upload-Offset", new_offset.to_string())
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Upload-Offset, Tus-Resumable")
        .body(axum::body::Body::empty())
        .unwrap())
}

// DELETE /api/upload/tus/:id - Terminate upload
pub async fn terminate_upload(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let chunk_path = format!("{}/tus-chunks/{}", state.config.storage_path, id);
    let meta_path = format!("{}/tus-chunks/{}.meta", state.config.storage_path, id);

    let _ = tokio::fs::remove_file(&chunk_path).await;
    let _ = tokio::fs::remove_file(&meta_path).await;

    Ok(Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("Tus-Resumable", TUS_VERSION)
        .body(axum::body::Body::empty())
        .unwrap())
}

// Background GC to clean up abandoned chunks (>24 hours)
pub fn spawn_tus_gc(storage_path: String) {
    tokio::spawn(async move {
        let chunk_dir = format!("{}/tus-chunks", storage_path);
        let max_age = std::time::Duration::from_secs(24 * 3600);

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30 * 60)).await;
            if let Ok(mut entries) = tokio::fs::read_dir(&chunk_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if let Ok(meta) = entry.metadata().await {
                        if let Ok(modified) = meta.modified() {
                            if let Ok(age) = modified.elapsed() {
                                if age > max_age {
                                    let path = entry.path();
                                    tracing::info!("Cleaning up expired TUS chunk: {:?}", path);
                                    let _ = tokio::fs::remove_file(path).await;
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}
