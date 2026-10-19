use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use std::path::PathBuf;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
use crate::state::AppState;

const TUS_VERSION: &str = "1.0.0";

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

    // Simpan metadata bila ada (file_name, folder_id)
    if let Some(metadata) = headers.get("upload-metadata") {
        if let Ok(meta_str) = metadata.to_str() {
            let meta_path = format!("{}/{}.meta", chunk_dir, upload_id);
            let _ = tokio::fs::write(&meta_path, meta_str).await;
        }
    }

    Ok(Response::builder()
        .status(StatusCode::CREATED)
        .header("Tus-Resumable", TUS_VERSION)
        .header(header::LOCATION, format!("/api/upload/tus/{}", upload_id))
        .header("Upload-Length", upload_length.to_string())
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Location, Tus-Resumable, Upload-Offset, Upload-Length")
        .body(axum::body::Body::empty())
        .unwrap())
}

// HEAD /api/upload/tus/:id - Get upload offset for auto-resume
pub async fn get_upload_offset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let chunk_path = format!("{}/tus-chunks/{}", state.config.storage_path, id);
    let metadata = tokio::fs::metadata(&chunk_path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "Upload not found".to_string()))?;

    let offset = metadata.len();

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Tus-Resumable", TUS_VERSION)
        .header("Upload-Offset", offset.to_string())
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Upload-Offset, Tus-Resumable")
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

    let chunk_path = format!("{}/tus-chunks/{}", state.config.storage_path, id);
    let current_meta = tokio::fs::metadata(&chunk_path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "Upload not found".to_string()))?;

    let current_offset = current_meta.len();
    if client_offset != current_offset {
        return Err((
            StatusCode::CONFLICT,
            format!("Upload-Offset mismatch (client={}, server={})", client_offset, current_offset),
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
