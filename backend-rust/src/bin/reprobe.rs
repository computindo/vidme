use std::env;
use std::path::Path;
use vidme_backend::config::Config;
use vidme_backend::db;
use vidme_backend::db::models::Video;
use vidme_backend::media::probe;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let dry_run = args.iter().any(|a| a == "--dry-run");
    let id_filter = args
        .iter()
        .find(|a| a.starts_with("--id="))
        .and_then(|a| a.strip_prefix("--id="))
        .map(|s| s.to_string());

    println!("========================================");
    println!("  VidMe Rust Reprobe Utility");
    println!("  Mode: {}", if dry_run { "DRY-RUN (No DB updates)" } else { "LIVE UPDATE" });
    if let Some(ref id) = id_filter {
        println!("  Filter ID: {}", id);
    }
    println!("========================================\n");

    let config = Config::from_env();
    let db_path = format!("{}/vidme.sqlite", config.storage_path);
    println!("Connecting to database: {}", db_path);
    let pool = db::init_pool(&db_path).await?;

    let videos: Vec<Video> = match &id_filter {
        Some(id) => {
            sqlx::query_as::<_, Video>("SELECT * FROM videos WHERE id = ? AND status = 'ready'")
                .bind(id)
                .fetch_all(&pool)
                .await?
        }
        None => {
            sqlx::query_as::<_, Video>("SELECT * FROM videos WHERE status = 'ready'")
                .fetch_all(&pool)
                .await?
        }
    };

    println!("Found {} video(s) to check.\n", videos.len());

    let mut count_ok = 0;
    let mut count_changed = 0;
    let mut count_missing = 0;

    let transcoded_dir = format!("{}/transcoded", config.storage_path);
    let original_dir = format!("{}/original", config.storage_path);

    for v in &videos {
        let transcoded_file = format!("{}/{}.mp4", transcoded_dir, v.id);
        let original_file = format!("{}/{}", original_dir, v.filename);

        let target_file = if Path::new(&transcoded_file).exists() {
            Some(transcoded_file)
        } else if Path::new(&original_file).exists() {
            Some(original_file)
        } else {
            None
        };

        let Some(file_path) = target_file else {
            println!("[MISSING] {} — \"{}\" (neither transcoded nor original found)", v.id, v.title);
            count_missing += 1;
            continue;
        };

        match probe::probe_video(&file_path).await {
            Ok(new_meta) => {
                let old_w = v.width.unwrap_or(0);
                let old_h = v.height.unwrap_or(0);
                let old_dur = v.duration.unwrap_or(0);
                let old_port = v.is_portrait == 1;

                let new_w = new_meta.width.unwrap_or(0);
                let new_h = new_meta.height.unwrap_or(0);
                let new_dur = new_meta.duration.unwrap_or(0);
                let new_port = new_meta.is_portrait;

                let is_diff = old_w != new_w
                    || old_h != new_h
                    || (old_dur - new_dur).abs() > 1
                    || old_port != new_port;

                if is_diff {
                    count_changed += 1;
                    println!(
                        "[CHANGED] {} — \"{}\": {}x{} ({}s, port={}) -> {}x{} ({}s, port={})",
                        v.id, v.title, old_w, old_h, old_dur, old_port, new_w, new_h, new_dur, new_port
                    );

                    if !dry_run {
                        if let Err(e) = db::videos::update_video_metadata(&pool, &v.id, &new_meta).await {
                            println!("  [ERROR] Failed to update DB: {}", e);
                        } else {
                            println!("  [UPDATED] DB row synchronized.");
                        }
                    }
                } else {
                    count_ok += 1;
                    println!("[OK] {} — \"{}\" ({}x{}, {}s)", v.id, v.title, old_w, old_h, old_dur);
                }
            }
            Err(e) => {
                println!("[ERROR] {} — probe failed: {}", v.id, e);
            }
        }
    }

    println!("\n========================================");
    println!("  Reprobe Completed!");
    println!("  Total: {} | OK: {} | Changed: {} | Missing: {}", videos.len(), count_ok, count_changed, count_missing);
    println!("========================================");

    Ok(())
}
