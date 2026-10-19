use super::models::{CreateFolderPayload, Folder, FolderTree, UpdateFolderPayload};
use sqlx::SqlitePool;
use std::collections::HashMap;

pub async fn list_folders_tree(pool: &SqlitePool) -> Result<Vec<FolderTree>, sqlx::Error> {
    let folders = sqlx::query_as::<_, Folder>(
        "SELECT id, name, parent_id, created_at FROM folders ORDER BY name ASC"
    )
    .fetch_all(pool)
    .await?;

    let counts: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT folder_id, COUNT(*) as count FROM videos WHERE folder_id IS NOT NULL GROUP BY folder_id"
    )
    .fetch_all(pool)
    .await?;

    let count_map: HashMap<String, i64> = counts
        .into_iter()
        .filter_map(|(fid, cnt)| fid.map(|id| (id, cnt)))
        .collect();

    let mut tree_nodes: HashMap<String, FolderTree> = HashMap::new();
    for f in &folders {
        let v_count = count_map.get(&f.id).copied().unwrap_or(0);
        tree_nodes.insert(
            f.id.clone(),
            FolderTree {
                id: f.id.clone(),
                name: f.name.clone(),
                parent_id: f.parent_id.clone(),
                created_at: f.created_at.clone(),
                video_count: v_count,
                children: Vec::new(),
            },
        );
    }

    let mut roots: Vec<FolderTree> = Vec::new();
    let mut children_map: HashMap<String, Vec<FolderTree>> = HashMap::new();

    for f in folders {
        if let Some(node) = tree_nodes.remove(&f.id) {
            match &node.parent_id {
                Some(pid) => {
                    children_map.entry(pid.clone()).or_default().push(node);
                }
                None => {
                    roots.push(node);
                }
            }
        }
    }

    fn attach_children(node: &mut FolderTree, children_map: &mut HashMap<String, Vec<FolderTree>>) {
        if let Some(children) = children_map.remove(&node.id) {
            node.children = children;
            for child in &mut node.children {
                attach_children(child, children_map);
            }
        }
    }

    for root in &mut roots {
        attach_children(root, &mut children_map);
    }

    Ok(roots)
}

pub async fn get_folder(pool: &SqlitePool, id: &str) -> Result<Option<Folder>, sqlx::Error> {
    sqlx::query_as::<_, Folder>("SELECT id, name, parent_id, created_at FROM folders WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn find_folder_by_name_and_parent(
    pool: &SqlitePool,
    name: &str,
    parent_id: Option<&str>,
) -> Result<Option<Folder>, sqlx::Error> {
    match parent_id {
        Some(pid) => {
            sqlx::query_as::<_, Folder>(
                "SELECT id, name, parent_id, created_at FROM folders WHERE name = ? AND parent_id = ?"
            )
            .bind(name)
            .bind(pid)
            .fetch_optional(pool)
            .await
        }
        None => {
            sqlx::query_as::<_, Folder>(
                "SELECT id, name, parent_id, created_at FROM folders WHERE name = ? AND parent_id IS NULL"
            )
            .bind(name)
            .fetch_optional(pool)
            .await
        }
    }
}

pub async fn create_folder(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    parent_id: Option<&str>,
) -> Result<Folder, sqlx::Error> {
    sqlx::query("INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)")
        .bind(id)
        .bind(name)
        .bind(parent_id)
        .execute(pool)
        .await?;

    get_folder(pool, id).await.map(|f| f.unwrap())
}

pub async fn update_folder(
    pool: &SqlitePool,
    id: &str,
    payload: &UpdateFolderPayload,
) -> Result<Option<Folder>, sqlx::Error> {
    let current = get_folder(pool, id).await?;
    let Some(mut folder) = current else {
        return Ok(None);
    };

    if let Some(ref name) = payload.name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            sqlx::query("UPDATE folders SET name = ? WHERE id = ?")
                .bind(trimmed)
                .bind(id)
                .execute(pool)
                .await?;
            folder.name = trimmed.to_string();
        }
    }

    if let Some(ref parent_opt) = payload.parent_id {
        match parent_opt {
            Some(pid) => {
                sqlx::query("UPDATE folders SET parent_id = ? WHERE id = ?")
                    .bind(pid)
                    .bind(id)
                    .execute(pool)
                    .await?;
                folder.parent_id = Some(pid.clone());
            }
            None => {
                sqlx::query("UPDATE folders SET parent_id = NULL WHERE id = ?")
                    .bind(id)
                    .execute(pool)
                    .await?;
                folder.parent_id = None;
            }
        }
    }

    Ok(Some(folder))
}

pub async fn delete_folder(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    sqlx::query("UPDATE videos SET folder_id = NULL WHERE folder_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    let res = sqlx::query("DELETE FROM folders WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(res.rows_affected() > 0)
}
