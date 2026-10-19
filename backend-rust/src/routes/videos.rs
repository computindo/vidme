use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use crate::{
    db::{
        models::{PinVideoPayload, UpdateVideoPayload},
        videos,
    },
    state::AppState,
};

#[derive(Deserialize)]
pub struct VideoListQuery {
    pub folder_id: Option<String>,
}

pub async fn list_videos(
    State(state): State<AppState>,
    Query(query): Query<VideoListQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let list = videos::list_videos(&state.pool, query.folder_id.as_deref())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(list))
}

pub async fn get_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let video = videos::get_video(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match video {
        Some(v) => Ok(Json(v)),
        None => Err((StatusCode::NOT_FOUND, "Video not found".to_string())),
    }
}

pub async fn update_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateVideoPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let updated = videos::update_video_details(&state.pool, &id, &payload)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match updated {
        Some(v) => {
            let sse_msg = serde_json::json!({
                "type": "video",
                "video": v
            });
            let _ = state.sse_tx.send(sse_msg.to_string());
            Ok(Json(v))
        }
        None => Err((StatusCode::NOT_FOUND, "Video not found".to_string())),
    }
}

pub async fn pin_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PinVideoPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let updated = videos::toggle_pin_video(&state.pool, &id, payload.is_pinned)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match updated {
        Some(v) => {
            let sse_msg = serde_json::json!({
                "type": "video",
                "video": v
            });
            let _ = state.sse_tx.send(sse_msg.to_string());
            Ok(Json(v))
        }
        None => Err((StatusCode::NOT_FOUND, "Video not found".to_string())),
    }
}

pub async fn delete_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let deleted = videos::delete_video(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !deleted {
        return Err((StatusCode::NOT_FOUND, "Video not found".to_string()));
    }

    let storage = &state.config.storage_path;
    let transcoded = format!("{}/transcoded/{}.mp4", storage, id);
    let thumb = format!("{}/thumbnails/{}.jpg", storage, id);
    let storyboard = format!("{}/thumbnails/{}.storyboard.jpg", storage, id);
    let clip = format!("{}/thumbnails/{}.clip.webm", storage, id);

    let _ = tokio::fs::remove_file(transcoded).await;
    let _ = tokio::fs::remove_file(thumb).await;
    let _ = tokio::fs::remove_file(storyboard).await;
    let _ = tokio::fs::remove_file(clip).await;

    let sse_msg = serde_json::json!({
        "type": "video:deleted",
        "id": id
    });
    let _ = state.sse_tx.send(sse_msg.to_string());

    Ok(Json(serde_json::json!({ "success": true })))
}
