use crate::config::Config;
use crate::media::worker::ProcessJob;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub sse_tx: broadcast::Sender<String>,
    pub worker_tx: mpsc::Sender<ProcessJob>,
}

impl AppState {
    pub fn new(
        pool: SqlitePool,
        config: Config,
        worker_tx: mpsc::Sender<ProcessJob>,
    ) -> (Self, broadcast::Receiver<String>) {
        let (sse_tx, sse_rx) = broadcast::channel(200);
        let state = Self {
            pool,
            config: Arc::new(config),
            sse_tx,
            worker_tx,
        };
        (state, sse_rx)
    }
}
