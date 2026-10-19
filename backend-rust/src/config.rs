use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub storage_path: String,
    pub webdav_user: String,
    pub webdav_pass: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(4100),
            storage_path: env::var("STORAGE_PATH").unwrap_or_else(|_| "/storage".to_string()),
            webdav_user: env::var("WEBDAV_USER").unwrap_or_else(|_| "vidme".to_string()),
            webdav_pass: env::var("WEBDAV_PASS").unwrap_or_else(|_| "vidme123".to_string()),
        }
    }
}
