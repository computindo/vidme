use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use std::path::{Path as StdPath, PathBuf};
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use crate::state::AppState;

fn safe_path(base_dir: &str, file_name: &str) -> Option<PathBuf> {
    let base = StdPath::new(base_dir);
    let resolved = base.join(file_name);
    if resolved.starts_with(base) {
        Some(resolved)
    } else {
        None
    }
}

pub async fn stream_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, String)> {
    let transcoded_dir = format!("{}/transcoded", state.config.storage_path);
    let file_path = safe_path(&transcoded_dir, &format!("{}.mp4", id))
        .ok_or((StatusCode::BAD_REQUEST, "Invalid path".to_string()))?;

    let file = File::open(&file_path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "Video file not found".to_string()))?;

    let metadata = file
        .metadata()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let file_size = metadata.len();

    // Check Range header
    if let Some(range_header) = headers.get(header::RANGE) {
        if let Ok(range_str) = range_header.to_str() {
            if let Some(bytes_range) = range_str.strip_prefix("bytes=") {
                let parts: Vec<&str> = bytes_range.split('-').collect();
                if let Ok(start) = parts[0].parse::<u64>() {
                    let end = if parts.len() > 1 && !parts[1].is_empty() {
                        parts[1].parse::<u64>().unwrap_or(file_size - 1)
                    } else {
                        file_size - 1
                    };

                    if start <= end && end < file_size {
                        let content_length = end - start + 1;
                        use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
                        let mut ranged_file = file;
                        ranged_file.seek(SeekFrom::Start(start)).await.map_err(|e| {
                            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                        })?;

                        let stream = ReaderStream::new(ranged_file.take(content_length));
                        let body = Body::from_stream(stream);

                        return Response::builder()
                            .status(StatusCode::PARTIAL_CONTENT)
                            .header(header::CONTENT_TYPE, "video/mp4")
                            .header(header::ACCEPT_RANGES, "bytes")
                            .header(header::CONTENT_LENGTH, content_length.to_string())
                            .header(
                                header::CONTENT_RANGE,
                                format!("bytes {}-{}/{}", start, end, file_size),
                            )
                            .body(body)
                            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
                    } else {
                        return Response::builder()
                            .status(StatusCode::RANGE_NOT_SATISFIABLE)
                            .header(header::CONTENT_RANGE, format!("bytes */{}", file_size))
                            .body(Body::empty())
                            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
                    }
                }
            }
        }
    }

    // Default: Full video (200 OK)
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .body(body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn get_thumb(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let thumb_dir = format!("{}/thumbnails", state.config.storage_path);
    let path = safe_path(&thumb_dir, &format!("{}.jpg", id))
        .ok_or((StatusCode::BAD_REQUEST, "Invalid path".to_string()))?;

    serve_static_file(&path, "image/jpeg").await
}

pub async fn get_storyboard(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let thumb_dir = format!("{}/thumbnails", state.config.storage_path);
    let path = safe_path(&thumb_dir, &format!("{}.storyboard.jpg", id))
        .ok_or((StatusCode::BAD_REQUEST, "Invalid path".to_string()))?;

    if tokio::fs::try_exists(&path).await.unwrap_or(false) {
        serve_static_file(&path, "image/jpeg").await
    } else {
        // Fallback 302 ke thumbnail biasa
        Ok(Response::builder()
            .status(StatusCode::FOUND)
            .header(header::LOCATION, format!("/thumb/{}", id))
            .body(Body::empty())
            .unwrap())
    }
}

pub async fn get_clip(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let thumb_dir = format!("{}/thumbnails", state.config.storage_path);
    let path = safe_path(&thumb_dir, &format!("{}.clip.webm", id))
        .ok_or((StatusCode::BAD_REQUEST, "Invalid path".to_string()))?;

    serve_static_file(&path, "video/webm").await
}

async fn serve_static_file(path: &StdPath, content_type: &str) -> Result<Response, (StatusCode, String)> {
    let file = File::open(path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "File not found".to_string()))?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
