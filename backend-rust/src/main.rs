mod config;
mod db;
mod media;
mod routes;
mod state;

use axum::{
    body::Body,
    http::{header, StatusCode, Uri},
    response::Response,
    routing::get,
    Router,
};
use config::Config;
use state::AppState;
use std::{net::SocketAddr, path::Path, sync::Arc};
use tokio::sync::mpsc;
use tower_http::{cors::CorsLayer, services::ServeDir};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn resolve_frontend_path() -> String {
    if Path::new("/app/frontend").exists() {
        "/app/frontend".to_string()
    } else if Path::new("./frontend").exists() {
        "./frontend".to_string()
    } else {
        "../frontend".to_string()
    }
}

async fn spa_fallback(frontend_path: String, uri: Uri) -> Response {
    let req_path = uri.path();
    if req_path.starts_with("/api")
        || req_path.starts_with("/stream")
        || req_path.starts_with("/thumb")
        || req_path.starts_with("/storyboard")
        || req_path.starts_with("/clip")
        || req_path.starts_with("/download")
        || req_path.starts_with("/webdav")
    {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap();
    }

    let index_file = format!("{}/index.html", frontend_path);
    if let Ok(content) = tokio::fs::read_to_string(&index_file).await {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(content))
            .unwrap()
    } else {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("index.html not found"))
            .unwrap()
    }
}

async fn serve_player(frontend_path: String) -> Response {
    let file = format!("{}/player.html", frontend_path);
    if let Ok(content) = tokio::fs::read_to_string(&file).await {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(content))
            .unwrap()
    } else {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("player.html not found"))
            .unwrap()
    }
}

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
    tracing::info!(
        "Initializing SQLite database at {}/vidme.sqlite",
        config.storage_path
    );

    let db_path = format!("{}/vidme.sqlite", config.storage_path);
    let pool = db::init_pool(&db_path).await?;

    let (worker_tx, worker_rx) = mpsc::channel(100);
    let (state, _sse_rx) = AppState::new(pool.clone(), config.clone(), worker_tx.clone());

    media::worker::spawn_media_worker(
        pool.clone(),
        state.config.clone(),
        state.sse_tx.clone(),
        worker_rx,
    );

    media::watcher::spawn_inbox_watcher(
        pool,
        state.config.clone(),
        state.sse_tx.clone(),
        worker_tx,
    );

    let frontend_dir = resolve_frontend_path();
    tracing::info!("Serving frontend assets from: {}", frontend_dir);

    let f1 = frontend_dir.clone();
    let f2 = frontend_dir.clone();

    let app = Router::new()
        .merge(routes::create_router())
        .route("/player.html", get(move || serve_player(f1)))
        .nest_service("/assets", ServeDir::new(format!("{}/assets", frontend_dir)))
        .nest_service("/js", ServeDir::new(format!("{}/js", frontend_dir)))
        .fallback(move |uri| spa_fallback(f2, uri))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Vidme Rust Backend listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
