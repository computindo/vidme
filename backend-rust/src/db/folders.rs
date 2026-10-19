use super::models::{Folder, FolderTree};
use sqlx::SqlitePool;
use std::collections::HashMap;

pub async fn list_folders_tree(pool: &SqlitePool) -> Result<Vec<FolderTree>, sqlx::Error> {
    let folders = sqlx::query_as::<_, Folder>(
        "SELECT id, name, parent_id, created_at FROM folders ORDER BY name ASC"
    )
    .fetch_all(pool)
    .await?;

    // Query count video per folder
    let counts: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT folder_id, COUNT(*) as count FROM videos WHERE folder_id IS NOT NULL GROUP BY folder_id"
    )
    .fetch_all(pool)
    .await?;

    let count_map: HashMap<String, i64> = counts
        .into_iter()
        .filter_map(|(fid, cnt)| fid.map(|id| (id, cnt)))
        .collect();

    // Bangun tree struktur
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
