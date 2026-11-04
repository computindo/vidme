use super::models::{UpdateVideoPayload, Video, VideoMeta};
use sqlx::SqlitePool;

pub async fn list_videos(pool: &SqlitePool, folder_id: Option<&str>) -> Result<Vec<Video>, sqlx::Error> {
    match folder_id {
        Some(fid) => {
            sqlx::query_as::<_, Video>(
                "SELECT * FROM videos WHERE folder_id = ? ORDER BY is_pinned DESC, created_at DESC"
            )
            .bind(fid)
            .fetch_all(pool)
            .await
        }
        None => {
            sqlx::query_as::<_, Video>(
                "SELECT * FROM videos ORDER BY is_pinned DESC, created_at DESC"
            )
            .fetch_all(pool)
            .await
        }
    }
}

pub async fn get_video(pool: &SqlitePool, id: &str) -> Result<Option<Video>, sqlx::Error> {
    sqlx::query_as::<_, Video>("SELECT * FROM videos WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn find_recent_duplicate(pool: &SqlitePool, title: &str) -> Result<Option<Video>, sqlx::Error> {
    sqlx::query_as::<_, Video>(
        "SELECT * FROM videos WHERE title = ? AND (status = 'processing' OR (julianday('now') - julianday(created_at)) * 86400 < 600) LIMIT 1"
    )
    .bind(title)
    .fetch_optional(pool)
    .await
}

pub async fn insert_video(
    pool: &SqlitePool,
    id: &str,
    title: &str,
    filename: &str,
    folder_id: Option<&str>,
    size_bytes: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO videos (id, title, filename, folder_id, size_bytes, status, is_pinned, has_480p, has_360p, has_storyboard, has_microclip)
         VALUES (?, ?, ?, ?, ?, 'processing', 0, 0, 0, 0, 0)"
    )
    .bind(id)
    .bind(title)
    .bind(filename)
    .bind(folder_id)
    .bind(size_bytes)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn update_video_metadata(
    pool: &SqlitePool,
    id: &str,
    meta: &VideoMeta,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE videos SET duration = ?, width = ?, height = ?, is_portrait = ?, fps = ? WHERE id = ?"
    )
    .bind(meta.duration)
    .bind(meta.width)
    .bind(meta.height)
    .bind(if meta.is_portrait { 1 } else { 0 })
    .bind(meta.fps)
    .bind(id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn update_video_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    size_bytes: Option<i64>,
) -> Result<(), sqlx::Error> {
    match size_bytes {
        Some(size) => {
            sqlx::query("UPDATE videos SET status = ?, size_bytes = ? WHERE id = ?")
                .bind(status)
                .bind(size)
                .bind(id)
                .execute(pool)
                .await?;
        }
        None => {
            sqlx::query("UPDATE videos SET status = ? WHERE id = ?")
                .bind(status)
                .bind(id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

pub async fn update_storyboard_status(
    pool: &SqlitePool,
    id: &str,
    has_storyboard: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE videos SET has_storyboard = ? WHERE id = ?")
        .bind(if has_storyboard { 1 } else { 0 })
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_microclip_status(
    pool: &SqlitePool,
    id: &str,
    has_microclip: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE videos SET has_microclip = ? WHERE id = ?")
        .bind(if has_microclip { 1 } else { 0 })
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_video_details(
    pool: &SqlitePool,
    id: &str,
    payload: &UpdateVideoPayload,
) -> Result<Option<Video>, sqlx::Error> {
    let current = get_video(pool, id).await?;
    let Some(mut video) = current else {
        return Ok(None);
    };

    if let Some(ref title) = payload.title {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            sqlx::query("UPDATE videos SET title = ? WHERE id = ?")
                .bind(trimmed)
                .bind(id)
                .execute(pool)
                .await?;
            video.title = trimmed.to_string();
        }
    }

    if let Some(ref folder_opt) = payload.folder_id {
        match folder_opt {
            Some(fid) => {
                sqlx::query("UPDATE videos SET folder_id = ? WHERE id = ?")
                    .bind(fid)
                    .bind(id)
                    .execute(pool)
                    .await?;
                video.folder_id = Some(fid.clone());
            }
            None => {
                sqlx::query("UPDATE videos SET folder_id = NULL WHERE id = ?")
                    .bind(id)
                    .execute(pool)
                    .await?;
                video.folder_id = None;
            }
        }
    }

    Ok(Some(video))
}

pub async fn toggle_pin_video(
    pool: &SqlitePool,
    id: &str,
    is_pinned: Option<bool>,
) -> Result<Option<Video>, sqlx::Error> {
    let current = get_video(pool, id).await?;
    let Some(video) = current else {
        return Ok(None);
    };

    let new_pin = match is_pinned {
        Some(pin) => if pin { 1 } else { 0 },
        None => if video.is_pinned == 1 { 0 } else { 1 },
    };

    sqlx::query("UPDATE videos SET is_pinned = ? WHERE id = ?")
        .bind(new_pin)
        .bind(id)
        .execute(pool)
        .await?;

    get_video(pool, id).await
}

pub async fn delete_video(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let res = sqlx::query("DELETE FROM videos WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}
