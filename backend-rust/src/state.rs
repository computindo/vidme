use crate::config::Config;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub sse_tx: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(pool: SqlitePool, config: Config) -> Self {
        let (sse_tx, _) = broadcast::channel(100);
        Self {
            pool,
            config: Arc::new(config),
            sse_tx,
        }
    }
}
