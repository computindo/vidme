use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Video {
    pub id: String,
    pub title: String,
    pub filename: String,
    pub folder_id: Option<String>,
    pub duration: Option<i64>,
    pub size_bytes: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub is_portrait: i64,
    pub is_pinned: i64,
    pub status: Option<String>,
    pub has_480p: i64,
    pub has_360p: i64,
    pub has_storyboard: i64,
    pub has_microclip: i64,
    pub fps: Option<f64>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderTree {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: Option<String>,
    pub video_count: i64,
    pub children: Vec<FolderTree>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateVideoPayload {
    pub title: Option<String>,
    pub folder_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PinVideoPayload {
    pub is_pinned: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateFolderPayload {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateFolderPayload {
    pub name: Option<String>,
    pub parent_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Default)]
pub struct VideoMeta {
    pub duration: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub is_portrait: bool,
    pub fps: Option<f64>,
    pub codec: Option<String>,
}
