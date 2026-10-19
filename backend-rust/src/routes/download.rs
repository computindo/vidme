use async_zip::{base::write::ZipFileWriter, Compression, ZipEntryBuilder};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use crate::{db::videos, state::AppState};

#[derive(Deserialize)]
pub struct BulkDownloadPayload {
    pub ids: Vec<String>,
}

pub async fn download_single(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let video = videos::get_video(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Video not found".to_string()))?;

    let transcoded_path = format!("{}/transcoded/{}.mp4", state.config.storage_path, id);
    let original_path = format!("{}/original/{}", state.config.storage_path, video.filename);

    let file_path = if tokio::fs::try_exists(&transcoded_path).await.unwrap_or(false) {
        transcoded_path
    } else if tokio::fs::try_exists(&original_path).await.unwrap_or(false) {
        original_path
    } else {
        return Err((StatusCode::NOT_FOUND, "Video file not found".to_string()));
    };

    let file = File::open(&file_path)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let file_size = file
        .metadata()
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let safe_title = video.title.replace(['"', '/', '\\'], "_");
    let content_disposition = format!("attachment; filename=\"{}.mp4\"", safe_title);

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::CONTENT_DISPOSITION, content_disposition)
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .body(body)
        .unwrap())
}

pub async fn bulk_download(
    State(state): State<AppState>,
    Json(payload): Json<BulkDownloadPayload>,
) -> Result<Response, (StatusCode, String)> {
    let ids: Vec<String> = payload.ids.into_iter().take(50).collect();
    if ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "No video IDs provided".to_string()));
    }

    let mut files_to_zip = Vec::new();
    for id in ids {
        if let Ok(Some(video)) = videos::get_video(&state.pool, &id).await {
            let transcoded_path = format!("{}/transcoded/{}.mp4", state.config.storage_path, id);
            let original_path = format!("{}/original/{}", state.config.storage_path, video.filename);

            let real_path = if tokio::fs::try_exists(&transcoded_path).await.unwrap_or(false) {
                Some(transcoded_path)
            } else if tokio::fs::try_exists(&original_path).await.unwrap_or(false) {
                Some(original_path)
            } else {
                None
            };

            if let Some(path) = real_path {
                let clean_title = video.title.replace(['"', '/', '\\'], "_");
                let entry_name = format!("{}.mp4", clean_title);
                files_to_zip.push((entry_name, path));
            }
        }
    }

    if files_to_zip.is_empty() {
        return Err((StatusCode::NOT_FOUND, "No files found for download".to_string()));
    }

    let (writer, reader) = tokio::io::duplex(64 * 1024);

    tokio::spawn(async move {
        let mut zip = ZipFileWriter::with_tokio(writer);

        for (name, path) in files_to_zip {
            if let Ok(mut file) = File::open(&path).await {
                let builder = ZipEntryBuilder::new(name.into(), Compression::Deflate);
                if let Ok(mut entry_writer) = zip.write_entry_stream(builder).await {
                    let _ = tokio::io::copy(&mut file, &mut entry_writer).await;
                    let _ = entry_writer.close().await;
                }
            }
        }

        let _ = zip.close().await;
    });

    let stream = ReaderStream::new(reader);
    let body = Body::from_stream(stream);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"vidme-download.zip\"",
        )
        .body(body)
        .unwrap())
}
