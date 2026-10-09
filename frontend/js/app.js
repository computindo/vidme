import { $, state } from './state.js';
import { api, idbGetAll, idbDel } from './api.js';
import { toast, openModal, closeModal, initDraggableModal } from './ui.js';
import {
  toggleLibraryPanel, selectFolder, renderLibraryPanel, showCtxMenu,
  renameFolder, moveFolder, deleteFolder, createNewFolder, initLibraryContextMenu
} from './library.js';
import {
  toggleUploadCenter, cancelUpload, clearUploadHistory, updateUploadBadge,
  renderUploadCenter, markUploadsDirty, initUploadQueue, initUploadForm,
  _idbQueue, _activeUploads, pumpQueue
} from './upload.js';
import {
  setSelectMode, toggleSelect, card, renderFolders, render,
  clearSearch, load, initBatchActions
} from './render.js';
import { openVideo, Router } from './router.js';
import {
  toggleSidebar, restoreSidebar, stopPreview,
  initHoverPreview, initSidebarBehavior
} from './sidebar.js';
import { PlayerView, initPlayerEvents } from './player.js';

// ── Window Bridge for Inline HTML / Template onclicks ──
Object.assign(window, {
  state, $, Router, PlayerView,
  selectFolder, showCtxMenu, renameFolder, moveFolder, deleteFolder,
  openModal, closeModal, toggleSidebar, toggleLibraryPanel, toggleUploadCenter,
  cancelUpload, clearUploadHistory, toggleSelect, clearSearch, createNewFolder,
  stopPreview, openVideo, render
});

// ── Bootstrap Initialization ──
initDraggableModal();
initLibraryContextMenu();
initUploadQueue();
initUploadForm();
initBatchActions();
initHoverPreview();
initSidebarBehavior();
initPlayerEvents();
restoreSidebar();

// ── Service Worker & Live Updates (SSE) ──
let swAlive = Date.now();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js');
  navigator.serviceWorker.addEventListener('message', e => {
    const { type } = e.data;
    if (type === 'sw-upload-progress') {
      const { uploadId, progress, status, lastChunk, totalChunks, bytesSent, bytesTotal } = e.data;
      const u = state.uploads.find(x => x.id === uploadId);
      if (u) {
        u.progress = progress;
        u.status = status;
        if (lastChunk !== undefined) u.lastChunk = lastChunk;
        if (totalChunks !== undefined) u.totalChunks = totalChunks;
        if (bytesSent !== undefined) { if (bytesSent !== u.bytesSent) u._anchorAt = Date.now(); u.bytesSent = bytesSent; }
        if (bytesTotal !== undefined) u.bytesTotal = bytesTotal;
        if (e.data.speed !== undefined) u.speed = e.data.speed;
        markUploadsDirty();
      }
    }
    if (type === 'sw-upload-done') {
      const { uploadId, success, status: s } = e.data;
      const u = state.uploads.find(x => x.id === uploadId);
      const title = e.data.title || (u ? u.title : uploadId);
      if (u) { u.progress = success ? 100 : u.progress; u.status = s; u.timestamp = Date.now(); renderUploadCenter(); }
      toast(success ? `✓ "${title}" uploaded` : `✗ Upload failed: ${title}`, success ? 'success' : 'error', success ? 4000 : 6000);
      idbDel(uploadId).catch(() => {});
      const qIdx = _idbQueue.findIndex(r => r.uploadId === uploadId);
      if (qIdx !== -1) _idbQueue.splice(qIdx, 1);
      pumpQueue();
      if (success) { load().catch(console.error); }
    }
    if (type === 'sw-upload-status-response') {
      e.data.uploads.forEach(su => {
        if (!state.uploads.find(u => u.id === su.uploadId)) {
          state.uploads.push({ id: su.uploadId, title: su.title || su.uploadId, status: su.status, progress: su.status === 'done' ? 100 : 0, timestamp: su.timestamp || null });
        }
      });
      updateUploadBadge();
      renderUploadCenter();
    }
    if (type === 'sw-heartbeat-ack') { swAlive = Date.now(); }
    if (type === 'sw-updated-reload') {
      const _ver = e.data.cache || '1';
      if (sessionStorage.getItem('vidme_sw_reloaded') !== _ver) {
        sessionStorage.setItem('vidme_sw_reloaded', _ver);
        location.reload();
      }
    }
  });

  navigator.serviceWorker.ready.then(async () => {
    navigator.serviceWorker.controller?.postMessage({ type: 'sw-upload-status' });
    navigator.serviceWorker.controller?.postMessage({ type: 'sw-debug-ping' });
    try {
      const pending = await idbGetAll();
      const now = Date.now();
      for (const rec of pending) {
        if (rec.status !== 'uploading') continue;
        if (now - rec.startedAt > 86400000) { idbDel(rec.uploadId).catch(() => {}); continue; }
        if (!rec.file || !rec.file.size) { idbDel(rec.uploadId).catch(() => {}); continue; }
        if (!state.uploads.find(u => u.id === rec.uploadId)) {
          state.uploads.push({ id: rec.uploadId, title: rec.title, status: 'uploading', progress: 0, timestamp: null });
        }
        navigator.serviceWorker.controller?.postMessage({ type: 'sw-upload-resume', uploadId: rec.uploadId });
        markUploadsDirty();
        toast(`Resuming upload: <b>${rec.title}</b>`, 'info');
      }
      updateUploadBadge();
      renderUploadCenter();
    } catch (err) { console.error('Resume check failed:', err); }
  });

  setInterval(() => {
    if (Date.now() - swAlive > 30000) {
      const stuck = state.uploads.filter(u => u.status === 'uploading');
      if (stuck.length) toast('Upload interrupted — will resume on next visit', 'error', 6000);
    }
    navigator.serviceWorker.controller?.postMessage({ type: 'sw-heartbeat' });
  }, 15000);
}

// ── SSE Live Updates ──
(function liveUpdates() {
  if (!window.EventSource) return;
  let es = null, retryMs = 3000, reconnectTimer = null;
  let hadConnected = false, lastCatchup = 0;

  function connect() {
    try { es = new EventSource('/api/events'); } catch (e) { return scheduleRetry(); }
    es.onopen = () => {
      retryMs = 3000;
      if (hadConnected && Date.now() - lastCatchup > 3000) {
        lastCatchup = Date.now();
        load().catch(console.error);
      }
      hadConnected = true;
    };
    es.onmessage = ev => {
      let d = null;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (!d) return;
      if (d.type === 'video' && d.id) {
        const v = state.videos.find(x => x.id === d.id);
        if (v) {
          const oldStatus = v.status;
          const changed = ['status','has_storyboard','has_microclip','duration','is_portrait','width','height'].some(k => String(v[k]) !== String(d[k]));
          Object.assign(v, d);
          if (changed) {
            stopPreview();
            if (d.status === 'ready' && oldStatus !== 'ready') {
              render();
            } else {
              const els = document.querySelectorAll(`.video-card[data-id="${d.id}"]`);
              if (els.length) els.forEach(el => { el.outerHTML = card(v); });
              else render();
            }
            if (d.status === 'ready') toast(`✓ <b>${d.title||'video'}</b> ready`, 'success');
          }
        } else if (d.status === 'ready') {
          load().catch(console.error);
        }
      }
    };
    es.onerror = () => { if (es) { es.close(); es = null; } scheduleRetry(); };
  }
  function scheduleRetry() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; retryMs = Math.min(retryMs * 2, 30000); connect(); }, retryMs);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (Date.now() - lastCatchup > 3000) { lastCatchup = Date.now(); load().catch(console.error); }
      if (!es) connect();
    }
  });
  connect();
  setInterval(() => {
    if (document.hidden) return;
    if (es && es.readyState !== 1) load().catch(console.error);
  }, 30000);
})();

// ── Global Listeners & Kickoff ──
window.onpopstate = () => { Router.renderRoute(); };
history.scrollRestoration = 'manual';

load().catch(console.error);

setInterval(() => {
  if (document.visibilityState === 'visible') {
    api('/api/folders').then(data => {
      state.folders = data;
      state.folderTree = (function buildTree(list, pid = null) {
        return list.filter(f => (f.parent_id || null) === pid).map(f => ({ ...f, children: buildTree(list, f.id) }));
      })(data);
      renderFolders();
    }).catch(() => {});
  }
}, 30000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && localStorage.getItem('vidme_refresh')) {
    localStorage.removeItem('vidme_refresh');
    load().catch(console.error);
  }
});
