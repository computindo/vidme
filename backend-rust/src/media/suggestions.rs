use crate::db::models::Video;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tracing::{error, info};

const ROTATION_DURATION_MS: i64 = 3 * 3600 * 1000; // 3 hours (user decision 05-11-26)
const SUGGESTIONS_PER_TURN: usize = 15;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuggestionsState {
    pub cycle: u64,
    pub turn_index: u64,
    pub last_rotation_ts: i64,
    pub next_rotation_ts: i64,
    pub current_ids: Vec<String>,
    pub deck: Vec<String>,
    pub used_ids: Vec<String>,
}

pub struct SuggestionsManager {
    file_path: PathBuf,
    state: Mutex<Option<SuggestionsState>>,
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn shuffle_ids(arr: &mut [String]) {
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    if seed == 0 {
        seed = 0xdeadbeefcafe;
    }
    for i in (1..arr.len()).rev() {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        let j = (seed as usize) % (i + 1);
        arr.swap(i, j);
    }
}

fn random_pos(len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    seed ^= seed << 13;
    seed ^= seed >> 7;
    seed ^= seed << 17;
    (seed as usize) % (len + 1)
}

impl SuggestionsManager {
    pub fn new(storage_path: &Path) -> Self {
        let file_path = storage_path.join("suggestions.json");
        Self {
            file_path,
            state: Mutex::new(None),
        }
    }

    fn read_disk(&self) -> Option<SuggestionsState> {
        if !self.file_path.exists() {
            return None;
        }
        match std::fs::read_to_string(&self.file_path) {
            Ok(content) => match serde_json::from_str::<SuggestionsState>(&content) {
                Ok(s) => Some(s),
                Err(e) => {
                    error!("Suggestions: failed to parse suggestions.json: {}", e);
                    None
                }
            },
            Err(e) => {
                error!("Suggestions: failed to read suggestions.json: {}", e);
                None
            }
        }
    }

    fn write_disk(&self, state: &SuggestionsState) {
        let tmp = self.file_path.with_extension("json.tmp");
        match serde_json::to_string_pretty(state) {
            Ok(json) => {
                if let Err(e) = std::fs::write(&tmp, json) {
                    error!("Suggestions: failed to write tmp suggestions.json: {}", e);
                    return;
                }
                if let Err(e) = std::fs::rename(&tmp, &self.file_path) {
                    error!("Suggestions: failed to atomic rename suggestions.json: {}", e);
                }
            }
            Err(e) => error!("Suggestions: serialization failed: {}", e),
        }
    }

    async fn get_ready_video_ids(&self, pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM videos WHERE status = 'ready' AND is_pinned = 0 ORDER BY rowid ASC",
        )
        .fetch_all(pool)
        .await
    }

    async fn reset_cycle(
        &self,
        pool: &SqlitePool,
        existing_cycle: Option<u64>,
    ) -> Result<SuggestionsState, sqlx::Error> {
        let mut all_ids = self.get_ready_video_ids(pool).await?;
        shuffle_ids(&mut all_ids);

        let current: Vec<String> = all_ids.iter().take(SUGGESTIONS_PER_TURN).cloned().collect();
        let deck: Vec<String> = all_ids.iter().skip(SUGGESTIONS_PER_TURN).cloned().collect();
        let now = current_timestamp_ms();
        let cycle = existing_cycle.unwrap_or(0) + 1;

        let new_state = SuggestionsState {
            cycle,
            turn_index: 1,
            last_rotation_ts: now,
            next_rotation_ts: now + ROTATION_DURATION_MS,
            current_ids: current,
            deck,
            used_ids: Vec::new(),
        };

        self.write_disk(&new_state);
        info!(
            "Suggestions: Cycle {} started with {} videos ({} current, {} remaining in deck, 3h rotation)",
            cycle,
            all_ids.len(),
            new_state.current_ids.len(),
            new_state.deck.len()
        );
        Ok(new_state)
    }

    pub async fn get_suggestions(&self, pool: &SqlitePool) -> Result<Vec<Video>, sqlx::Error> {
        let mut lock = self.state.lock().await;
        let mut state = match lock.take() {
            Some(s) => s,
            None => self.read_disk().unwrap_or_else(|| SuggestionsState {
                cycle: 0,
                turn_index: 0,
                last_rotation_ts: 0,
                next_rotation_ts: 0,
                current_ids: Vec::new(),
                deck: Vec::new(),
                used_ids: Vec::new(),
            }),
        };

        let now = current_timestamp_ms();

        if state.current_ids.is_empty() && state.deck.is_empty() {
            state = self.reset_cycle(pool, None).await?;
        } else if now >= state.next_rotation_ts {
            // Waktunya rotasi siklus berikutnya (rotasi per 3 jam)
            let mut used = state.used_ids;
            used.extend(state.current_ids);
            let mut deck = state.deck;

            if deck.len() >= SUGGESTIONS_PER_TURN {
                state.turn_index += 1;
                state.current_ids = deck.drain(0..SUGGESTIONS_PER_TURN).collect();
                state.deck = deck;
                state.used_ids = used;
                state.last_rotation_ts = now;
                state.next_rotation_ts = now + ROTATION_DURATION_MS;
                self.write_disk(&state);
                info!(
                    "Suggestions: Turn rotated to index {}, {} left in deck",
                    state.turn_index,
                    state.deck.len()
                );
            } else if !deck.is_empty() {
                let remaining = deck.clone();
                let needed = SUGGESTIONS_PER_TURN - remaining.len();
                let remaining_set: HashSet<String> = remaining.iter().cloned().collect();

                let all_ready = self.get_ready_video_ids(pool).await?;
                let mut pool_new: Vec<String> = all_ready
                    .into_iter()
                    .filter(|id| !remaining_set.contains(id))
                    .collect();
                shuffle_ids(&mut pool_new);

                state.cycle += 1;
                state.turn_index = 1;
                let top_up: Vec<String> = pool_new.drain(0..std::cmp::min(needed, pool_new.len())).collect();
                let mut current = remaining;
                current.extend(top_up);
                state.current_ids = current;
                state.deck = pool_new;
                state.used_ids = Vec::new();
                state.last_rotation_ts = now;
                state.next_rotation_ts = now + ROTATION_DURATION_MS;
                self.write_disk(&state);
                info!(
                    "Suggestions: Cycle reset to {} (carried {} from previous deck)",
                    state.cycle,
                    state.current_ids.len()
                );
            } else {
                state = self.reset_cycle(pool, Some(state.cycle)).await?;
            }
        }

        let current_ids = state.current_ids.clone();
        *lock = Some(state);
        drop(lock);

        // Fetch actual video objects in order of current_ids
        let mut result = Vec::new();
        for id in &current_ids {
            if let Ok(Some(video)) = sqlx::query_as::<_, Video>(
                "SELECT * FROM videos WHERE id = ? AND status = 'ready'",
            )
            .bind(id)
            .fetch_optional(pool)
            .await
            {
                result.push(video);
            }
        }

        Ok(result)
    }

    pub async fn on_video_added(&self, id: &str) {
        let mut lock = self.state.lock().await;
        if lock.is_none() {
            *lock = self.read_disk();
        }
        let Some(state) = lock.as_mut() else { return };

        let mut all_known = HashSet::new();
        for x in &state.current_ids {
            all_known.insert(x.as_str());
        }
        for x in &state.deck {
            all_known.insert(x.as_str());
        }
        for x in &state.used_ids {
            all_known.insert(x.as_str());
        }

        if all_known.contains(id) {
            return;
        }

        let pos = random_pos(state.deck.len());
        state.deck.insert(pos, id.to_string());
        self.write_disk(state);
        info!(
            "Suggestions: New video {} queued into deck at position {}/{}",
            id,
            pos,
            state.deck.len()
        );
    }

    pub async fn on_video_deleted(&self, id: &str) {
        let mut lock = self.state.lock().await;
        if lock.is_none() {
            *lock = self.read_disk();
        }
        let Some(state) = lock.as_mut() else { return };

        let mut modified = false;

        let before_deck = state.deck.len();
        state.deck.retain(|x| x != id);
        if state.deck.len() != before_deck {
            modified = true;
        }

        let before_used = state.used_ids.len();
        state.used_ids.retain(|x| x != id);
        if state.used_ids.len() != before_used {
            modified = true;
        }

        let before_curr = state.current_ids.len();
        state.current_ids.retain(|x| x != id);
        if state.current_ids.len() != before_curr {
            if !state.deck.is_empty() {
                let replacement = state.deck.remove(0);
                state.current_ids.push(replacement);
            }
            modified = true;
        }

        if modified {
            self.write_disk(state);
            info!("Suggestions: Removed video {} from suggestions state", id);
        }
    }
}
