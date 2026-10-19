use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use uuid::Uuid;
use crate::{
    db::{
        folders,
        models::{CreateFolderPayload, UpdateFolderPayload},
    },
    state::AppState,
};

pub async fn list_folders(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let tree = folders::list_folders_tree(&state.pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(tree))
}

pub async fn create_folder(
    State(state): State<AppState>,
    Json(payload): Json<CreateFolderPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let folder_id = Uuid::new_v4().to_string();
    let folder = folders::create_folder(
        &state.pool,
        &folder_id,
        &payload.name,
        payload.parent_id.as_deref(),
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(folder)))
}

pub async fn update_folder(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateFolderPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let updated = folders::update_folder(&state.pool, &id, &payload)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match updated {
        Some(f) => Ok(Json(f)),
        None => Err((StatusCode::NOT_FOUND, "Folder not found".to_string())),
    }
}

pub async fn delete_folder(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let deleted = folders::delete_folder(&state.pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if deleted {
        Ok(Json(serde_json::json!({ "success": true })))
    } else {
        Err((StatusCode::NOT_FOUND, "Folder not found".to_string()))
    }
}
