use super::models::{Album, CreateAlbumPayload, UpdateAlbumPayload};
use sqlx::SqlitePool;

pub async fn list_albums(pool: &SqlitePool) -> Result<Vec<Album>, sqlx::Error> {
    sqlx::query_as::<_, Album>(
        "SELECT a.id, a.name, a.description, a.cover_video_id, a.cover_image, a.created_at,
                COUNT(av.video_id) AS video_count
         FROM albums a
         LEFT JOIN album_videos av ON av.album_id = a.id
         GROUP BY a.id
         ORDER BY a.created_at DESC"
    )
    .fetch_all(pool)
    .await
}

pub async fn get_album(pool: &SqlitePool, id: &str) -> Result<Option<Album>, sqlx::Error> {
    sqlx::query_as::<_, Album>(
        "SELECT a.id, a.name, a.description, a.cover_video_id, a.cover_image, a.created_at,
                COUNT(av.video_id) AS video_count
         FROM albums a
         LEFT JOIN album_videos av ON av.album_id = a.id
         WHERE a.id = ?
         GROUP BY a.id"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_album(
    pool: &SqlitePool,
    id: &str,
    payload: &CreateAlbumPayload,
) -> Result<Album, sqlx::Error> {
    sqlx::query("INSERT INTO albums (id, name, description, cover_video_id) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(&payload.name)
        .bind(&payload.description)
        .bind(&payload.cover_video_id)
        .execute(pool)
        .await?;

    get_album(pool, id).await.map(|a| a.unwrap())
}

pub async fn update_album(
    pool: &SqlitePool,
    id: &str,
    payload: &UpdateAlbumPayload,
) -> Result<Option<Album>, sqlx::Error> {
    let current = get_album(pool, id).await?;
    let Some(mut album) = current else {
        return Ok(None);
    };

    if let Some(ref name) = payload.name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            sqlx::query("UPDATE albums SET name = ? WHERE id = ?")
                .bind(trimmed)
                .bind(id)
                .execute(pool)
                .await?;
            album.name = trimmed.to_string();
        }
    }

    if let Some(ref description) = payload.description {
        sqlx::query("UPDATE albums SET description = ? WHERE id = ?")
            .bind(description)
            .bind(id)
            .execute(pool)
            .await?;
        album.description = Some(description.clone());
    }

    if let Some(ref cover_video_id) = payload.cover_video_id {
        sqlx::query("UPDATE albums SET cover_video_id = ? WHERE id = ?")
            .bind(cover_video_id)
            .bind(id)
            .execute(pool)
            .await?;
        album.cover_video_id = Some(cover_video_id.clone());
    }

    Ok(Some(album))
}

pub async fn delete_album(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    // Videos are never touched; only membership rows and the album itself are removed
    sqlx::query("DELETE FROM album_videos WHERE album_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    let res = sqlx::query("DELETE FROM albums WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(res.rows_affected() > 0)
}

pub async fn add_videos_to_album(
    pool: &SqlitePool,
    album_id: &str,
    video_ids: &[String],
) -> Result<u64, sqlx::Error> {
    if video_ids.is_empty() {
        return Ok(0);
    }

    let placeholders: Vec<&str> = video_ids.iter().map(|_| "?").collect();
    let query = format!(
        "INSERT OR IGNORE INTO album_videos (album_id, video_id)
         SELECT ?, id FROM videos WHERE id IN ({})",
        placeholders.join(", ")
    );

    let mut q = sqlx::query(&query).bind(album_id);
    for vid in video_ids {
        q = q.bind(vid);
    }

    let res = q.execute(pool).await?;
    Ok(res.rows_affected())
}

pub async fn remove_videos_from_album(
    pool: &SqlitePool,
    album_id: &str,
    video_ids: &[String],
) -> Result<u64, sqlx::Error> {
    if video_ids.is_empty() {
        return Ok(0);
    }

    let placeholders: Vec<&str> = video_ids.iter().map(|_| "?").collect();
    let query = format!(
        "DELETE FROM album_videos WHERE album_id = ? AND video_id IN ({})",
        placeholders.join(", ")
    );

    let mut q = sqlx::query(&query).bind(album_id);
    for vid in video_ids {
        q = q.bind(vid);
    }

    let res = q.execute(pool).await?;
    Ok(res.rows_affected())
}

pub async fn list_album_video_ids(pool: &SqlitePool, album_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT video_id FROM album_videos WHERE album_id = ? ORDER BY added_at ASC"
    )
    .bind(album_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| r.0).collect())
}

pub async fn set_cover_video(
    pool: &SqlitePool,
    album_id: &str,
    video_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE albums SET cover_video_id = ? WHERE id = ?")
        .bind(video_id)
        .bind(album_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_cover_image(
    pool: &SqlitePool,
    album_id: &str,
    path: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE albums SET cover_image = ? WHERE id = ?")
        .bind(path)
        .bind(album_id)
        .execute(pool)
        .await?;
    Ok(())
}
