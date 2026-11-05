use axum::{
    extract::State,
    http::{header, HeaderName, HeaderValue},
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::stream::Stream;
use std::{convert::Infallible, time::Duration};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use crate::state::AppState;

pub async fn sse_handler(
    State(state): State<AppState>,
) -> (
    [(HeaderName, HeaderValue); 2],
    Sse<impl Stream<Item = Result<Event, Infallible>>>,
) {
    let rx = state.sse_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(data) => Some(Ok(Event::default().data(data))),
        Err(_) => None,
    });

    let sse = Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(25))
            .text("ka"),
    );

    let headers = [
        (header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-transform")),
        (HeaderName::from_static("x-accel-buffering"), HeaderValue::from_static("no")),
    ];

    (headers, sse)
}
