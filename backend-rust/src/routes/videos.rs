use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use crate::{
    db::videos,
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
    let videos = videos::list_videos(&state.pool, query.folder_id.as_deref())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(videos))
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
