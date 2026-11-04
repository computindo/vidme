pub mod download;
pub mod events;
pub mod folders;
pub mod stream;
pub mod upload_tus;
pub mod videos;
pub mod webdav;

use axum::{
    routing::{get, patch, post},
    Router,
};
use crate::state::AppState;

pub fn create_router() -> Router<AppState> {
    Router::new()
        // Video Routes
        .route("/api/videos", get(videos::list_videos))
        .route(
            "/api/videos/:id",
            get(videos::get_video)
                .patch(videos::update_video)
                .delete(videos::delete_video),
        )
        .route("/api/videos/:id/pin", patch(videos::pin_video))
        // Folder Routes
        .route(
            "/api/folders",
            get(folders::list_folders).post(folders::create_folder),
        )
        .route(
            "/api/folders/:id",
            patch(folders::update_folder).delete(folders::delete_folder),
        )
        // Streaming & Asset Routes
        .route("/stream/:id", get(stream::stream_video))
        .route("/thumb/:id", get(stream::get_thumb))
        .route("/storyboard/:id", get(stream::get_storyboard))
        .route("/clip/:id", get(stream::get_clip))
        // Realtime SSE
        .route("/api/events", get(events::sse_handler))
        // Download Routes
        .route("/download/:id", get(download::download_single))
        .route("/api/videos/bulk-download", post(download::bulk_download))
        // TUS Upload Routes
        .route("/api/upload/tus", post(upload_tus::create_upload))
        .route(
            "/api/upload/tus/:id",
            get(upload_tus::get_upload_offset)
                .head(upload_tus::get_upload_offset)
                .patch(upload_tus::upload_chunk)
                .delete(upload_tus::terminate_upload),
        )
        // WebDAV Handler
        .route("/webdav", axum::routing::any(webdav::webdav_handler))
        .route("/webdav/*path", axum::routing::any(webdav::webdav_handler))
}
