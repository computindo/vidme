use axum::{
    body::Body,
    extract::DefaultBodyLimit,
    http::{header, StatusCode, Uri},
    response::Response,
    routing::get,
    Router,
};
use std::{net::SocketAddr, path::Path};
use tokio::sync::mpsc;
use tower_http::{cors::CorsLayer, services::ServeDir};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use vidme_backend::{config::Config, db, media, routes, state::AppState};

fn resolve_frontend_path() -> String {
    if Path::new("/app/frontend").exists() {
        "/app/frontend".to_string()
    } else if Path::new("./frontend").exists() {
        "./frontend".to_string()
    } else {
        "../frontend".to_string()
    }
}

// vidme-static-root: content-type minimal untuk aset root frontend
fn static_content_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".json") {
        "application/json"
    } else if lower.ends_with(".webmanifest") {
        "application/manifest+json"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".txt") {
        "text/plain; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

// vidme-static-root: decode percent-encoding (%20 dst) untuk lookup file statis
fn decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = bytes[i + 1];
            let l = bytes[i + 2];
            let hv = match h {
                b'0'..=b'9' => Some(h - b'0'),
                b'a'..=b'f' => Some(h - b'a' + 10),
                b'A'..=b'F' => Some(h - b'A' + 10),
                _ => None,
            };
            let lv = match l {
                b'0'..=b'9' => Some(l - b'0'),
                b'a'..=b'f' => Some(l - b'a' + 10),
                b'A'..=b'F' => Some(l - b'A' + 10),
                _ => None,
            };
            if let (Some(hv), Some(lv)) = (hv, lv) {
                out.push(hv * 16 + lv);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
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

    // vidme-static-root: sajikan file statis root (favicon.svg, manifest.json, dst)
    // sebelum jatuh ke index.html. Dulu hanya /assets & /js yang dilayani sehingga
    // /favicon.svg selalu dibalikin HTML (browser menganggap favicon tidak ada).
    let raw_rel = req_path.trim_start_matches('/');
    let rel = decode_path(raw_rel);
    let traversal = rel.split('/').any(|seg| seg == "..") || rel.contains('\0');
    if !rel.is_empty() && !traversal {
        let candidate = format!("{}/{}", frontend_path, rel);
        if let Ok(m) = tokio::fs::metadata(&candidate).await {
            if m.is_file() {
                if let Ok(bytes) = tokio::fs::read(&candidate).await {
                    let ctype = static_content_type(&rel);
                    return Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, ctype)
                        .body(Body::from(bytes))
                        .unwrap();
                }
            }
        }
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
    let config = Config::from_env();
    let log_dir = format!("{}/logs", config.storage_path);
    let _ = tokio::fs::create_dir_all(&log_dir).await;

    let file_appender = tracing_appender::rolling::never(&log_dir, "app.log");
    let (non_blocking, _log_guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vidme_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_ansi(true))
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(non_blocking),
        )
        .init();

    tracing::info!(
        "Initializing SQLite database at {}/vidme.sqlite",
        config.storage_path
    );

    let db_path = format!("{}/vidme.sqlite", config.storage_path);
    let pool = db::init_pool(&db_path).await?;

    // Create background worker channel
    let (worker_tx, worker_rx) = mpsc::channel(100);
    let (state, _sse_rx) = AppState::new(pool.clone(), config.clone(), worker_tx.clone());

    // Spawn media worker
    media::worker::spawn_media_worker(
        pool.clone(),
        state.config.clone(),
        state.sse_tx.clone(),
        state.suggestions.clone(),
        worker_rx,
    );

    // Spawn WebDAV inbox watcher
    media::watcher::spawn_inbox_watcher(
        pool,
        state.config.clone(),
        state.sse_tx.clone(),
        worker_tx,
    );

    // Spawn TUS abandoned chunks GC (runs every 30m)
    routes::upload_tus::spawn_tus_gc(state.config.storage_path.clone());

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
        .layer(DefaultBodyLimit::disable())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Vidme Rust Backend listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
