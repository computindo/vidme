pub mod videos;
pub mod folders;
pub mod stream;
pub mod upload_tus;

use axum::{
    routing::get,
    Router,
};
use crate::state::AppState;

pub fn create_router() -> Router<AppState> {
    Router::new()
        .route("/api/videos", get(videos::list_videos))
        .route("/api/videos/:id", get(videos::get_video))
        .route("/api/folders", get(folders::list_folders))
        .route("/stream/:id", get(stream::stream_video))
        .route("/thumb/:id", get(stream::get_thumb))
        .route("/storyboard/:id", get(stream::get_storyboard))
        .route("/clip/:id", get(stream::get_clip))
}
