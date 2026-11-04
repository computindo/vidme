import { appState } from './state.svelte.js';

export async function fetchVideos() {
  try {
    appState.isLoading = true;
    const res = await fetch('/api/videos');
    if (res.ok) {
      appState.videos = await res.json();
    }
  } catch (err) {
    appState.addToast(`Gagal memuat video: ${err.message}`, 'error');
  } finally {
    appState.isLoading = false;
  }
}

export async function fetchFolders() {
  try {
    const res = await fetch('/api/folders');
    if (res.ok) {
      appState.folders = await res.json();
    }
  } catch (err) {
    console.error('Failed to fetch folders:', err);
  }
}

export async function pinVideo(id, isPinned) {
  try {
    const res = await fetch(`/api/videos/${id}/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: isPinned }),
    });
    if (res.ok) {
      const updated = await res.json();
      updateVideoInState(updated);
      appState.addToast(isPinned ? 'Video disematkan' : 'Sematkan dibatalkan', 'success');
    }
  } catch (err) {
    appState.addToast(`Gagal pin video: ${err.message}`, 'error');
  }
}

export async function deleteVideo(id) {
  try {
    const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      appState.videos = appState.videos.filter((v) => v.id !== id);
      appState.addToast('Video berhasil dihapus', 'success');
      if (appState.activeVideoId === id) {
        appState.navigate('/');
      }
    }
  } catch (err) {
    appState.addToast(`Gagal menghapus video: ${err.message}`, 'error');
  }
}

export async function updateVideoTitle(id, title) {
  try {
    const res = await fetch(`/api/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const updated = await res.json();
      updateVideoInState(updated);
      appState.addToast('Judul berhasil diubah', 'success');
    }
  } catch (err) {
    appState.addToast(`Gagal mengubah judul: ${err.message}`, 'error');
  }
}

export function updateVideoInState(video) {
  const idx = appState.videos.findIndex((v) => v.id === video.id);
  if (idx !== -1) {
    appState.videos[idx] = { ...appState.videos[idx], ...video };
  } else {
    appState.videos.unshift(video);
  }
}

export function initSSE() {
  const es = new EventSource('/api/events');

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'video' && data.video) {
        updateVideoInState(data.video);
      } else if (data.type === 'video:deleted' && data.id) {
        appState.videos = appState.videos.filter((v) => v.id !== data.id);
      }
    } catch (err) {
      console.error('SSE message parse error:', err);
    }
  };

  es.onerror = () => {
    // EventSource auto-reconnects
  };

  return es;
}
