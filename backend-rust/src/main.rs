mod config;
mod db;
mod routes;
mod state;

use axum::Router;
use config::Config;
use state::AppState;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vidme_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    tracing::info!("Initializing SQLite database at {}/vidme.sqlite", config.storage_path);

    let db_path = format!("{}/vidme.sqlite", config.storage_path);
    let pool = db::init_pool(&db_path).await?;

    let state = AppState::new(pool, config.clone());

    let app = Router::new()
        .merge(routes::create_router())
        .route("/api/upload/tus", axum::routing::post(routes::upload_tus::create_upload))
        .route(
            "/api/upload/tus/:id",
            axum::routing::get(routes::upload_tus::get_upload_offset)
                .head(routes::upload_tus::get_upload_offset)
                .patch(routes::upload_tus::upload_chunk)
                .delete(routes::upload_tus::terminate_upload),
        )
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Vidme Rust Backend listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
