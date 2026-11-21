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
      appState.parseCurrentUrl();
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
    const copy = [...appState.videos];
    copy[idx] = { ...copy[idx], ...video };
    appState.videos = copy;
  } else {
    appState.videos = [video, ...appState.videos];
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

export async function fetchSuggestions() {
  try {
    const res = await fetch('/api/suggestions');
    if (res.ok) {
      appState.suggestions = await res.json();
    }
  } catch (err) {
    console.error('Failed to fetch suggestions:', err);
  }
}

export async function bulkDeleteVideos(ids) {
  if (!ids || ids.length === 0) return;
  try {
    await Promise.all(ids.map((id) => fetch(`/api/videos/${id}`, { method: 'DELETE' })));
    appState.videos = appState.videos.filter((v) => !ids.includes(v.id));
    appState.selectedIds = [];
    appState.isSelectMode = false;
    appState.addToast(`${ids.length} video berhasil dihapus`, 'success');
  } catch (err) {
    appState.addToast(`Gagal menghapus video: ${err.message}`, 'error');
  }
}

export async function bulkPinVideos(ids, isPinned) {
  if (!ids || ids.length === 0) return;
  try {
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/videos/${id}/pin`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_pinned: isPinned }),
        })
      )
    );
    appState.videos = appState.videos.map((v) =>
      ids.includes(v.id) ? { ...v, is_pinned: isPinned ? 1 : 0 } : v
    );
    appState.selectedIds = [];
    appState.isSelectMode = false;
    appState.addToast(`${ids.length} video ${isPinned ? 'disematkan' : 'batal disematkan'}`, 'success');
  } catch (err) {
    appState.addToast(`Gagal pin video: ${err.message}`, 'error');
  }
}

export async function fetchAlbums() {
  try {
    const res = await fetch('/api/albums');
    if (res.ok) {
      appState.albums = await res.json();
      appState.parseCurrentUrl();
    }
  } catch (err) {
    console.error('Failed to fetch albums:', err);
  }
}

export async function fetchAlbumVideoIds(albumId) {
  const res = await fetch(`/api/albums/${albumId}/videos`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function createAlbum(name, opts = {}) {
  try {
    const res = await fetch('/api/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...opts }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const album = await res.json();
    appState.albums = [...appState.albums, album];
    appState.addToast('Album dibuat', 'success');
    return album;
  } catch (err) {
    appState.addToast(`Gagal membuat album: ${err.message}`, 'error');
    return null;
  }
}

export async function updateAlbum(id, payload) {
  try {
    const res = await fetch(`/api/albums/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const album = await res.json();
    appState.albums = appState.albums.map((a) => (a.id === id ? album : a));
    appState.addToast('Album diperbarui', 'success');
    return album;
  } catch (err) {
    appState.addToast(`Gagal memperbarui album: ${err.message}`, 'error');
    return null;
  }
}

export async function deleteAlbum(id) {
  try {
    const res = await fetch(`/api/albums/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    appState.albums = appState.albums.filter((a) => a.id !== id);
    const { [id]: _, ...members } = appState.albumMembers;
    appState.albumMembers = members;
    appState.addToast('Album dihapus (video tetap aman)', 'success');
    return true;
  } catch (err) {
    appState.addToast(`Gagal menghapus album: ${err.message}`, 'error');
    return false;
  }
}

export async function uploadAlbumCover(albumId, file) {
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/albums/${albumId}/cover`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const album = await res.json();
    appState.albums = appState.albums.map((a) => (a.id === albumId ? album : a));
    appState.addToast('Cover album diunggah', 'success');
    return album;
  } catch (err) {
    appState.addToast(`Gagal unggah cover: ${err.message}`, 'error');
    return null;
  }
}

export async function setAlbumCoverVideo(albumId, videoId) {
  return updateAlbum(albumId, { cover_video_id: videoId });
}

export async function addVideoToAlbum(videoId, albumId) {
  await bulkAddToAlbum([videoId], albumId);
}

export async function removeVideoFromAlbum(videoId, albumId) {
  await bulkRemoveFromAlbum([videoId], albumId);
}

export async function setVideoTags(id, tags) {
  const norm = String(tags || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .join(',');
  try {
    const res = await fetch(`/api/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: norm }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = await res.json();
    updateVideoInState(updated);
    appState.addToast('Tag disimpan', 'success');
    return updated;
  } catch (err) {
    appState.addToast(`Gagal set tag: ${err.message}`, 'error');
    return null;
  }
}

export async function bulkSetTags(ids, tags) {
  if (!ids || ids.length === 0) return;
  const norm = tags.toLowerCase();
  try {
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/videos/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: norm }),
        })
      )
    );
    appState.videos = appState.videos.map((v) => (ids.includes(v.id) ? { ...v, tags: norm } : v));
    appState.selectedIds = [];
    appState.isSelectMode = false;
    appState.addToast(`Tag disimpan untuk ${ids.length} video`, 'success');
  } catch (err) {
    appState.addToast(`Gagal set tag: ${err.message}`, 'error');
  }
}

export async function bulkAddToAlbum(ids, albumId) {
  if (!ids || ids.length === 0) return;
  try {
    const res = await fetch(`/api/albums/${albumId}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: ids }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    appState.selectedIds = [];
    appState.isSelectMode = false;
    appState.addToast(`${ids.length} video ditambahkan ke album`, 'success');
    await appState.fetchAllAlbumMemberships();
  } catch (err) {
    appState.addToast(`Gagal menambahkan ke album: ${err.message}`, 'error');
  }
}

export async function bulkRemoveFromAlbum(ids, albumId) {
  if (!ids || ids.length === 0) return;
  try {
    const res = await fetch(`/api/albums/${albumId}/videos`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: ids }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    appState.addToast(`${ids.length} video dihapus dari album`, 'success');
    await appState.fetchAllAlbumMemberships();
  } catch (err) {
    appState.addToast(`Gagal menghapus dari album: ${err.message}`, 'error');
  }
}

export async function bulkMoveFolder(ids, folderId) {
  if (!ids || ids.length === 0) return;
  try {
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/videos/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_id: folderId }),
        })
      )
    );
    appState.videos = appState.videos.map((v) => (ids.includes(v.id) ? { ...v, folder_id: folderId } : v));
    appState.selectedIds = [];
    appState.isSelectMode = false;
    appState.addToast(
      folderId ? `${ids.length} video dipindahkan ke folder` : `${ids.length} video dikeluarkan dari folder`,
      'success'
    );
  } catch (err) {
    appState.addToast(`Gagal memindahkan folder: ${err.message}`, 'error');
  }
}
