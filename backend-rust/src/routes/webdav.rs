use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::Response,
};
use base64::Engine;
use futures_util::StreamExt;
use std::path::PathBuf;
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;
use crate::{db, state::AppState};

fn esc_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn check_auth(headers: &HeaderMap, state: &AppState) -> bool {
    if let Some(auth) = headers.get(header::AUTHORIZATION) {
        if let Ok(auth_str) = auth.to_str() {
            if let Some(b64) = auth_str.strip_prefix("Basic ") {
                if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
                    if let Ok(cred) = String::from_utf8(decoded) {
                        let parts: Vec<&str> = cred.splitn(2, ':').collect();
                        if parts.len() == 2 {
                            return parts[0] == state.config.webdav_user
                                && parts[1] == state.config.webdav_pass;
                        }
                    }
                }
            }
        }
    }
    false
}

fn auth_challenge() -> Response {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::WWW_AUTHENTICATE, "Basic realm=\"VidMe WebDAV\"")
        .body(Body::empty())
        .unwrap()
}

pub async fn webdav_handler(
    State(state): State<AppState>,
    method: Method,
    headers: HeaderMap,
    req: Request,
) -> Response {
    if !check_auth(&headers, &state) {
        return auth_challenge();
    }

    let req_uri_path = req.uri().path().to_string();
    let sub_path = req_uri_path
        .strip_prefix("/webdav")
        .unwrap_or(&req_uri_path)
        .trim_matches('/')
        .to_string();

    let inbox_dir = format!("{}/webdav-inbox", state.config.storage_path);
    let _ = fs::create_dir_all(&inbox_dir).await;

    match method {
        Method::OPTIONS => Response::builder()
            .status(StatusCode::OK)
            .header("DAV", "1,2")
            .header("Allow", "OPTIONS, PROPFIND, GET, PUT, DELETE, MKCOL")
            .header("MS-Author-Via", "DAV")
            .body(Body::empty())
            .unwrap(),

        m if m.as_str() == "PROPFIND" => {
            handle_propfind(&inbox_dir, &sub_path, &headers).await
        }

        m if m.as_str() == "MKCOL" => {
            handle_mkcol(&state, &inbox_dir, &sub_path).await
        }

        Method::PUT => {
            handle_put(&state, &inbox_dir, &sub_path, req.into_body()).await
        }

        Method::GET => handle_get(&inbox_dir, &sub_path).await,

        Method::DELETE => {
            let target_path = if sub_path.is_empty() {
                PathBuf::from(&inbox_dir)
            } else {
                PathBuf::from(&inbox_dir).join(&sub_path)
            };
            if fs::try_exists(&target_path).await.unwrap_or(false) {
                if let Ok(meta) = fs::metadata(&target_path).await {
                    if meta.is_dir() {
                        let _ = fs::remove_dir_all(&target_path).await;
                    } else {
                        let _ = fs::remove_file(&target_path).await;
                    }
                    return Response::builder()
                        .status(StatusCode::NO_CONTENT)
                        .body(Body::empty())
                        .unwrap();
                }
            }
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::empty())
                .unwrap()
        }

        _ => Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(Body::empty())
            .unwrap(),
    }
}

async fn handle_propfind(inbox_dir: &str, sub_path: &str, headers: &HeaderMap) -> Response {
    let target = if sub_path.is_empty() {
        PathBuf::from(inbox_dir)
    } else {
        PathBuf::from(inbox_dir).join(sub_path)
    };

    if !fs::try_exists(&target).await.unwrap_or(false) {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap();
    }

    let meta = match fs::metadata(&target).await {
        Ok(m) => m,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .unwrap()
        }
    };

    let depth = headers
        .get("depth")
        .and_then(|d| d.to_str().ok())
        .unwrap_or("1");

    let mut responses = Vec::new();
    let href_base = if sub_path.is_empty() {
        "/webdav/".to_string()
    } else {
        format!("/webdav/{}/", sub_path)
    };

    if meta.is_dir() {
        responses.push(format!(
            "<D:response><D:href>{}</D:href><D:propstat><D:prop><D:displayname>{}</D:displayname><D:getcontentlength>0</D:getcontentlength><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
            esc_xml(&href_base),
            esc_xml(target.file_name().and_then(|n| n.to_str()).unwrap_or(""))
        ));

        if depth != "0" {
            if let Ok(mut entries) = fs::read_dir(&target).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_name.starts_with('.') || file_name.ends_with(".folderid") {
                        continue;
                    }
                    if let Ok(child_meta) = entry.metadata().await {
                        let is_dir = child_meta.is_dir();
                        let child_href = format!(
                            "{}{}{}",
                            href_base,
                            file_name,
                            if is_dir { "/" } else { "" }
                        );
                        let size = if is_dir { 0 } else { child_meta.len() };
                        let rtype = if is_dir {
                            "<D:collection/>"
                        } else {
                            ""
                        };

                        responses.push(format!(
                            "<D:response><D:href>{}</D:href><D:propstat><D:prop><D:displayname>{}</D:displayname><D:getcontentlength>{}</D:getcontentlength><D:resourcetype>{}</D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
                            esc_xml(&child_href),
                            esc_xml(&file_name),
                            size,
                            rtype
                        ));
                    }
                }
            }
        }
    } else {
        let file_name = target.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let href = format!("/webdav/{}", sub_path);
        responses.push(format!(
            "<D:response><D:href>{}</D:href><D:propstat><D:prop><D:displayname>{}</D:displayname><D:getcontentlength>{}</D:getcontentlength><D:resourcetype></D:resourcetype><D:getcontenttype>video/mp4</D:getcontenttype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
            esc_xml(&href),
            esc_xml(file_name),
            meta.len()
        ));
    }

    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<D:multistatus xmlns:D=\"DAV:\">\n{}\n</D:multistatus>",
        responses.join("\n")
    );

    Response::builder()
        .status(StatusCode::MULTI_STATUS)
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(Body::from(xml))
        .unwrap()
}

async fn handle_mkcol(state: &AppState, inbox_dir: &str, sub_path: &str) -> Response {
    if sub_path.is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::empty())
            .unwrap();
    }

    let parts: Vec<&str> = sub_path.split('/').filter(|s| !s.is_empty()).collect();
    let folder_name = parts.last().unwrap();

    let dir_path = PathBuf::from(inbox_dir).join(sub_path);
    if fs::try_exists(&dir_path).await.unwrap_or(false) {
        return Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(Body::empty())
            .unwrap();
    }

    let _ = fs::create_dir_all(&dir_path).await;

    // Insert ke DB folders
    let folder_id = Uuid::new_v4().to_string();
    let _ = db::folders::create_folder(&state.pool, &folder_id, folder_name, None).await;

    Response::builder()
        .status(StatusCode::CREATED)
        .body(Body::empty())
        .unwrap()
}

async fn handle_put(
    state: &AppState,
    inbox_dir: &str,
    sub_path: &str,
    body: Body,
) -> Response {
    if sub_path.is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::empty())
            .unwrap();
    }

    let target_path = PathBuf::from(inbox_dir).join(sub_path);
    if let Some(parent) = target_path.parent() {
        let _ = fs::create_dir_all(parent).await;

        // Attribute folder if upload is inside a subfolder
        if let Some(parent_name) = parent.file_name().and_then(|n| n.to_str()) {
            if parent_name != "webdav-inbox" && !parent_name.is_empty() {
                if let Ok(Some(row)) = sqlx::query_as::<_, (String,)>("SELECT id FROM folders WHERE name = ?")
                    .bind(parent_name)
                    .fetch_optional(&state.pool)
                    .await
                {
                    let sidecar = format!("{}.folderid", target_path.display());
                    let _ = fs::write(&sidecar, row.0).await;
                }
            }
        }
    }

    let mut file = match File::create(&target_path).await {
        Ok(f) => f,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from(e.to_string()))
                .unwrap();
        }
    };

    let mut stream = body.into_data_stream();
    while let Some(chunk_res) = stream.next().await {
        match chunk_res {
            Ok(chunk) => {
                if let Err(e) = file.write_all(&chunk).await {
                    let _ = fs::remove_file(&target_path).await;
                    return Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Body::from(e.to_string()))
                        .unwrap();
                }
            }
            Err(e) => {
                let _ = fs::remove_file(&target_path).await;
                return Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .body(Body::from(e.to_string()))
                    .unwrap();
            }
        }
    }

    let _ = file.flush().await;

    Response::builder()
        .status(StatusCode::CREATED)
        .body(Body::empty())
        .unwrap()
}

async fn handle_get(inbox_dir: &str, sub_path: &str) -> Response {
    let target = PathBuf::from(inbox_dir).join(sub_path);
    if let Ok(file) = File::open(&target).await {
        let stream = ReaderStream::new(file);
        Response::builder()
            .status(StatusCode::OK)
            .body(Body::from_stream(stream))
            .unwrap()
    } else {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap()
    }
}
