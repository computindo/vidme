use super::models::Video;
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

pub async fn delete_video(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let res = sqlx::query("DELETE FROM videos WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}
