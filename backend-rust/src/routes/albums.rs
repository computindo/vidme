use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use std::path::Path as StdPath;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
use crate::{
    db::{
        albums,
        models::{AlbumMembersPayload, CreateAlbumPayload, UpdateAlbumPayload},
    },
    routes::stream::serve_static_file,
    state::AppState,
};

const COVER_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

fn cover_path(state: &AppState, album_id: &str, ext: &str) -> String {
    format!("{}/covers/{}.{}", state.config.storage_path, album_id, ext)
}

fn cover_content_type(path: &str) -> &'static str {
    let ext = StdPath::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    }
}

pub async fn list_albums(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let list = albums::list_albums(&state.pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(list))
}

pub async fn create_album(
    State(state): State<AppState>,
    Json(payload): Json<CreateAlbumPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let album_id = Uuid::new_v4().to_string();
    let album = albums::create_album(&state.pool, &album_id, &payload)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(album)))
}

pub async fn get_album(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let album = albums::get_album(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match album {
        Some(a) => Ok(Json(a)),
        None => Err((StatusCode::NOT_FOUND, "Album not found".to_string())),
    }
}

pub async fn update_album(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateAlbumPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let updated = albums::update_album(&state.pool, &id, &payload)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match updated {
        Some(a) => Ok(Json(a)),
        None => Err((StatusCode::NOT_FOUND, "Album not found".to_string())),
    }
}

pub async fn delete_album(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let deleted = albums::delete_album(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !deleted {
        return Err((StatusCode::NOT_FOUND, "Album not found".to_string()));
    }

    // Album is gone; clean up its own cover files (videos are never touched)
    for ext in COVER_EXTENSIONS {
        let _ = tokio::fs::remove_file(cover_path(&state, &id, ext)).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_videos_to_album(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AlbumMembersPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let existing = albums::get_album(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing.is_none() {
        return Err((StatusCode::NOT_FOUND, "Album not found".to_string()));
    }

    let added = albums::add_videos_to_album(&state.pool, &id, &payload.video_ids)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true, "added": added })))
}

pub async fn remove_videos_from_album(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AlbumMembersPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let existing = albums::get_album(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing.is_none() {
        return Err((StatusCode::NOT_FOUND, "Album not found".to_string()));
    }

    let removed = albums::remove_videos_from_album(&state.pool, &id, &payload.video_ids)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true, "removed": removed })))
}

pub async fn list_album_videos(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let existing = albums::get_album(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing.is_none() {
        return Err((StatusCode::NOT_FOUND, "Album not found".to_string()));
    }

    let videos = albums::list_album_videos(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(videos))
}

pub async fn set_album_cover(
    State(state): State<AppState>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let existing = albums::get_album(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing.is_none() {
        return Err((StatusCode::NOT_FOUND, "Album not found".to_string()));
    }

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let filename = field.file_name().unwrap_or("").to_string();
        let ext = StdPath::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if !COVER_EXTENSIONS.contains(&ext.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                "Only jpg, jpeg, png, or webp images are allowed".to_string(),
            ));
        }

        let data = field
            .bytes()
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

        let covers_dir = format!("{}/covers", state.config.storage_path);
        tokio::fs::create_dir_all(&covers_dir)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        // Remove stale covers with a different extension before writing the new one
        for old_ext in COVER_EXTENSIONS {
            if old_ext != ext {
                let _ = tokio::fs::remove_file(cover_path(&state, &id, old_ext)).await;
            }
        }

        let cover = cover_path(&state, &id, &ext);
        let mut file = tokio::fs::File::create(&cover)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        file.write_all(&data)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        file.flush()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        drop(file);

        albums::set_cover_image(&state.pool, &id, Some(cover.as_str()))
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let album = albums::get_album(&state.pool, &id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        return match album {
            Some(a) => Ok(Json(a)),
            None => Err((StatusCode::NOT_FOUND, "Album not found".to_string())),
        };
    }

    Err((StatusCode::BAD_REQUEST, "Missing 'file' field".to_string()))
}

pub async fn get_cover_image(
    State(state): State<AppState>,
    Path(album_id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let album = albums::get_album(&state.pool, &album_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let cover = album
        .and_then(|a| a.cover_image)
        .ok_or((StatusCode::NOT_FOUND, "Album cover not found".to_string()))?;

    let content_type = cover_content_type(&cover);
    serve_static_file(StdPath::new(&cover), content_type).await
}
