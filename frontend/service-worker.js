// vidme-rc5
// vidme-rc3.3
// vidme-rc3.2
// vidme-rc3
// VidMe Service Worker v5 — native fetch TUS client.
// No tus-js-client: its browser stack is XHR-only, and SW has no XMLHttpRequest.
// TUS flow: POST create -> Location; PATCH chunks w/ Upload-Offset; HEAD for resume; DELETE to cancel.
const CACHE = "vidme-v2.9.1";
const STATIC = ['/', '/index.html', '/player.html'];
const DB_NAME = 'vidme-uploads';
const DB_STORE = 'uploads';
const HEARTBEAT_INTERVAL = 15000;
const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24h
const TUS_ENDPOINT = '/api/upload/tus';
const TUS_CHUNK_SIZE = 4 * 1024 * 1024; // vidme-rc4: 4MB — keputusan Naufal, struktur chunk jangan diubah (hindari load peak server)
const TUS_RETRIES = 5;
const TUS_RETRY_DELAY = 800; // vidme-rc3: was 1000 — pemulihan lebih cepat di link naik-turun
// 18-09-26: slow-network hardening
const TUS_CHUNK_TIMEOUT = 180000;   // 3 min per chunk: 4MB @ 0.2MB/s = 20s; 180s = ~0.02MB/s floor
const TUS_409_RETRIES = 3;          // on 409 INVALID_OFFSET: HEAD-resync then retry chunk
// speed EMA (exponential moving average) for ETA; alpha=0.3 => responsive but stable
let _speedEma = 0;                  // bytes/sec
function _updateSpeed(bytes, secs) {
  if (!(secs > 0) || !(bytes > 0)) return;
  const inst = bytes / secs;
  _speedEma = _speedEma ? (_speedEma * 0.7 + inst * 0.3) : inst;
}

// -- IndexedDB helpers (survives SW restart) --
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbGetAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// -- Active uploads: uploadId -> AbortController --
const activeUploads = new Map();

function broadcast(msg) {
  self.clients.matchAll().then(clients => clients.forEach(c => c.postMessage(msg)));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function b64(str) {
  const bytes = new TextEncoder().encode(String(str || ''));
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function patchAbortable(err) {
  return err && (err.name === 'AbortError');
}

// -- Core upload: native fetch TUS --
async function doUpload(uploadId, file, title, folderId, filename, tusUrl) {
  const ctrl = new AbortController();
  activeUploads.set(uploadId, ctrl);
  const signal = ctrl.signal;
  try {
    let offset = 0;
    if (tusUrl) {
      // Resume: HEAD for current server-side offset, skip POST
      const h = await fetch(tusUrl, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' }, signal });
      if (!h.ok) throw new Error('TUS resume HEAD failed: HTTP ' + h.status);
      offset = parseInt(h.headers.get('Upload-Offset') || '0', 10) || 0;
    } else {
      const meta = [
        'filename ' + b64(filename),
        'title ' + b64(title || ''),
        'folderId ' + b64(folderId || ''),
      ].join(',');
      const endpoint = new URL(TUS_ENDPOINT, self.location.origin).href;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(file.size),
          'Upload-Metadata': meta,
        },
        signal,
      });
      if (res.status !== 201) throw new Error('TUS create failed: HTTP ' + res.status);
      const loc = res.headers.get('Location');
      if (!loc) throw new Error('TUS create: missing Location header');
      // Resolve relative Location (relativeLocation: true) + force page protocol (mixed-content behind HTTPS proxy)
      tusUrl = new URL(loc, self.location.origin).href.startsWith('http://')
        ? new URL(loc, self.location.origin).href.replace('http://', 'https://')
        : new URL(loc, self.location.origin).href;
      // Persist upload URL immediately so resume survives SW/OS kill
      idbGet(uploadId).then(rec => {
        if (rec) { rec.tusUrl = tusUrl; rec.lastActivity = Date.now(); idbPut(uploadId, rec).catch(() => {}); }
      }).catch(() => {});
    }

    while (offset < file.size) {
      const end = Math.min(offset + TUS_CHUNK_SIZE, file.size);
      const body = file.slice(offset, end);
      let newOffset = null;
      let lastErr = null;
      let conflictResyncs = 0;
      for (let attempt = 0; attempt <= TUS_RETRIES; attempt++) {
        if (attempt > 0) await sleep(TUS_RETRY_DELAY * Math.pow(2, attempt - 1));
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const _c0 = Date.now();
        // vidme-rc3: TUS_CHUNK_TIMEOUT sudah dideklarasi sejak 18-09-26 tapi TIDAK PERNAH
        // dipakai — tidak ada watchdog, jadi PATCH yang menggantung (TCP black-hole setelah
        // reset di koneksi Orbit) menunggu sampai OS timeout sendiri: progress bar diam
        // menit-menitan. Sekarang tiap chunk dibatalkan setelah timeout lalu di-retry.
        const chunkCtrl = new AbortController();
        const _onParentAbort = () => chunkCtrl.abort();
        signal.addEventListener('abort', _onParentAbort, { once: true });
        const _wd = setTimeout(() => chunkCtrl.abort(), TUS_CHUNK_TIMEOUT);
        try {
          const r = await fetch(tusUrl, {
            method: 'PATCH',
            headers: {
              'Tus-Resumable': '1.0.0',
              'Content-Type': 'application/offset+octet-stream',
              'Upload-Offset': String(offset),
            },
            body,
            signal: chunkCtrl.signal,
          });
          if (r.status === 204) {
            clearTimeout(_wd);
            newOffset = parseInt(r.headers.get('Upload-Offset') || '0', 10) || end;
            _updateSpeed(end - offset, (Date.now() - _c0) / 1000);
            lastErr = null;
            break;
          }
          // 409 INVALID_OFFSET: offset kita stale (PATCH sebelumnya ternyata landing, atau tab/retry
          // lain sudah menulis). Re-sync dari server via HEAD, lalu lanjutkan dari offset server.
          if (r.status === 409 && conflictResyncs < TUS_409_RETRIES) {
            conflictResyncs++;
            const h = await fetch(tusUrl, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' }, signal });
            if (h.ok) {
              const srvOffset = parseInt(h.headers.get('Upload-Offset') || '0', 10) || 0;
              if (srvOffset !== offset) {
                // vidme-rc3.3: WAJIB isi newOffset juga. Sebelumnya hanya `offset` yang
                // diupdate, sementara `offset = newOffset` setelah loop menimpanya dengan
                // null -> progress reset ke 0% dan while-loop mengirim ulang dari byte 0
                // dengan header Upload-Offset: "null" -> 409 -> resync -> null lagi:
                // loop tak berujung yang membakar bandwidth dan menggantung upload.
                offset = srvOffset;
                newOffset = srvOffset;
                broadcast({ type: 'sw-upload-progress', uploadId, progress: (offset / file.size) * 100, status: 'uploading', bytesSent: offset, bytesTotal: file.size, speed: _speedEma });
                break;
              }
            }
          }
          lastErr = new Error('TUS PATCH failed: HTTP ' + r.status);
          if (r.status >= 400 && r.status < 500 && r.status !== 429) break; // client error: retry futile
        } catch (e) {
          // vidme-rc3.2: patchAbortable() true untuk SEMUA AbortError, termasuk abort
          // watchdog. Re-throw HANYA kalau signal INDUK yang dibatalkan (user cancel);
          // abort watchdog (signal induk hidup) harus jatuh ke retry loop di bawah.
          if (patchAbortable(e) && signal.aborted) throw e;
          if (e && e.name === 'AbortError') {
            lastErr = new Error('chunk timeout after ' + Math.round(TUS_CHUNK_TIMEOUT / 1000) + 's');
          } else {
            lastErr = e;
          }
        } finally {
          clearTimeout(_wd);
          signal.removeEventListener('abort', _onParentAbort);
        }
      }
      if (lastErr) throw lastErr;
      // vidme-rc3.3: guard — offset tidak pernah boleh jadi null. Kalau ini pernah
      // ke-trigger, ada jalur break baru yang lupa mengisi newOffset; lebih baik gagal
      // cepat (outer catch menyimpan IDB & resume) daripada loop dari byte 0.
      if (newOffset === null || !Number.isFinite(newOffset)) throw new Error('TUS: chunk offset lost (newOffset=' + newOffset + ')');
      offset = newOffset;
      broadcast({ type: 'sw-upload-progress', uploadId, progress: (offset / file.size) * 100, status: 'uploading', bytesSent: offset, bytesTotal: file.size, speed: _speedEma });
      idbGet(uploadId).then(rec => {
        if (rec) { rec.bytesDone = offset; rec.totalSize = file.size; rec.tusUrl = tusUrl; rec.lastActivity = Date.now(); rec.speed = _speedEma; idbPut(uploadId, rec).catch(() => {}); }
      }).catch(() => {});
    }

    await idbDel(uploadId).catch(() => {});
    broadcast({ type: 'sw-upload-done', uploadId, success: true, title, status: 'done' });
  } catch (err) {
    activeUploads.delete(uploadId);
    if (patchAbortable(err)) return; // cancelled: handler already cleans up
    const rec = await idbGet(uploadId).catch(() => null);
    if (!tusUrl) {
      // Create failed: nothing to resume
      await idbDel(uploadId).catch(() => {});
      broadcast({ type: 'sw-upload-done', uploadId, success: false, title, status: 'error', message: String((err && err.message) || err) });
      return;
    }
    // Upload was in-progress (tusUrl exists): keep IDB record as 'uploading'
    // so online-event/interval resume can pick up. Don't broadcast error —
    // user doesn't see a failure toast, upload silently resumes when connection returns.
    if (rec) { rec.status = 'uploading'; rec.lastActivity = Date.now(); idbPut(uploadId, rec).catch(() => {}); }
    return;
  }
  activeUploads.delete(uploadId);
}

// -- Resume: rehydrate from IDB and continue via TUS offset --
async function resumeUpload(uploadId) {
  if (activeUploads.has(uploadId)) return;
  const rec = await idbGet(uploadId);
  if (!rec || rec.status !== 'uploading') return;
  if (Date.now() - rec.startedAt > STALE_THRESHOLD) {
    await idbDel(uploadId);
    broadcast({ type: 'sw-upload-done', uploadId, success: false, title: rec.title, status: 'error', message: 'Upload expired (>24h)' });
    return;
  }
  const file = rec.file;
  if (!file || !file.size) {
    await idbDel(uploadId);
    broadcast({ type: 'sw-upload-done', uploadId, success: false, title: rec.title, status: 'error', message: 'File no longer available' });
    return;
  }
  doUpload(uploadId, file, rec.title, rec.folderId, rec.filename, rec.tusUrl || null).catch(() => {});
}


// -- Resume all uploading records (used by online event + interval + activate) --
async function resumeAll() {
  const all = await idbGetAll().catch(() => []);
  const now = Date.now();
  for (const rec of all) {
    if (rec.status !== 'uploading') continue;
    if (now - rec.startedAt > STALE_THRESHOLD) {
      await idbDel(rec.uploadId).catch(() => {});
      continue;
    }
    if (!rec.file || !rec.file.size) {
      await idbDel(rec.uploadId).catch(() => {});
      continue;
    }
    if (!activeUploads.has(rec.uploadId)) {
      doUpload(rec.uploadId, rec.file, rec.title, rec.folderId, rec.filename, rec.tusUrl || null).catch(() => {});
    }
  }
}

// -- Message handler --
self.addEventListener('message', async (e) => {
  const d = e.data;

  if (d.type === 'sw-upload-start') {
    const _swExt = (d.filename || '').split('.').pop().toLowerCase();
    const _swValid = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'ts', 'm4v', '3gp', 'flv', 'wmv'].includes(_swExt);
    if (!_swValid) { broadcast({ type: 'sw-upload-done', uploadId: d.uploadId, ok: false, success: false, error: 'Format tidak didukung: .' + _swExt, status: 'error' }); return; }
    // Seed IDB record if page did not
    idbGet(d.uploadId).then(rec => {
      if (!rec) {
        return idbPut(d.uploadId, {
          uploadId: d.uploadId, file: d.file, title: d.title, folderId: d.folderId, filename: d.filename,
          totalSize: d.file.size, bytesDone: 0, tusUrl: null,
          status: 'uploading', startedAt: Date.now(), lastActivity: Date.now(),
        }).catch(() => {});
      }
    }).catch(() => {}).finally(() => {
      doUpload(d.uploadId, d.file, d.title, d.folderId, d.filename, null).catch(() => {});
    });
  }

  if (d.type === 'sw-upload-resume') {
    resumeUpload(d.uploadId);
  }

  if (d.type === 'sw-upload-cancel') {
    const ctrl = activeUploads.get(d.uploadId);
    if (ctrl) {
      ctrl.abort();
      activeUploads.delete(d.uploadId);
    }
    // Terminate partial file server-side
    const rec = await idbGet(d.uploadId).catch(() => null);
    const url = rec && rec.tusUrl;
    await idbDel(d.uploadId).catch(() => {});
    if (url) {
      try { await fetch(url, { method: 'DELETE', headers: { 'Tus-Resumable': '1.0.0' } }); } catch (err) {}
    }
  }

  if (d.type === 'sw-upload-status') {
    const statuses = [];
    for (const [id] of activeUploads) {
      statuses.push({ uploadId: id, status: 'uploading' });
    }
    e.source.postMessage({ type: 'sw-upload-status-response', uploads: statuses });
  }

  if (d.type === 'sw-heartbeat') {
    e.source.postMessage({ type: 'sw-heartbeat-ack' });
  }
});

// -- On SW activation: clean stale uploads + resume pending --
self.addEventListener('activate', (e) => {
  e.waitUntil(
    // 19-09-26 v2.1: detect "this is an UPDATE, not a first install" by looking for
    // caches left over from a previous SW version (in-memory flags reset every SW
    // instance, so they cannot carry this signal). Old cache present -> an update
    // landed -> tell every open page to reload once so it runs matching index.html
    // (the SSE client lives there; stale JS never opens /api/events).
    caches.keys().then(keys => {
      const isUpdate = keys.some(k => k !== CACHE);
      return Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))).then(() => isUpdate);
    })
      .then(isUpdate => self.clients.claim().then(() => isUpdate))
      .then(async (isUpdate) => {
        if (isUpdate) {
          const cs = await self.clients.matchAll({ type: 'window' });
          cs.forEach(c => { try { c.postMessage({ type: 'sw-updated-reload', cache: CACHE }); } catch (e) {} });
        }
        await resumeAll().catch(() => {});
      })
  );
});


// -- Auto-resume: online event + periodic check (Problem #2 fix) --
self.addEventListener('online', () => {
  resumeAll().catch(() => {});
});
setInterval(() => {
  if (navigator.onLine) resumeAll().catch(() => {});
}, 30000);

// -- Cache & fetch --
// vidme-rc5: skipWaiting() HARUS dipanggil sebelum waitUntil precache. Sebelumnya
// addAll(STATIC) ada di dalam waitUntil: di koneksi lambat (HP 3Mbps + upload aktif)
// fetch '/' bisa gagal -> waitUntil reject -> INSTALL GAGAL -> SW nyangkut di state
// 'installing' selamanya -> skipWaiting tidak pernah jalan -> SW lama tetap active ->
// halaman lama tanpa SSE listener terus dipakai (mobile tidak auto-update).
// Sekarang install sukses selalu; precache yang gagal cuma berarti cache kosong
// (fallback offline hilang, tapi SSE + halaman baru tetap jalan — prioritas benar).
self.addEventListener('install', e => {
  self.skipWaiting(); // rc5 pattern: install always succeeds, precache non-blocking
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {})));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (['/api', '/stream', '/thumb', '/storyboard', '/download'].some(p => url.pathname.startsWith(p))) {
    e.respondWith(fetch(e.request));
    return;
  }
  // 19-09-26: /clip/ montase is immutable per video id (regenerated only on re-encode).
  // Cache-first: hover preview no longer re-downloads ~300KB every hover — critical on
  // slow links where a re-fetch made hover feel dead while an upload was running.
  if (url.pathname.startsWith('/clip/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
    );
    return;
  }
  // Network-first for page navigations: SPA HTML (player/index) is served at
  // per-video URLs; cache-first would pin stale HTML forever after edits.
  if (e.request.mode === 'navigate') {
    // SPA intercept: player-URL shapes serve the SPA shell (/) — Ticket 06
    const segs = url.pathname.split('/').filter(Boolean);
    const isPlayerUrl = (segs.length === 2 && segs[0] === 'v') ||
                        (segs.length === 3 && segs[1] === 'v') ||
                        (segs.length === 4 && segs[0] === 'library' && segs[2] === 'v'); // vidme-v2.2
    if (isPlayerUrl) {
      e.respondWith(
        fetch('/').then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put('/', clone));
          }
          return res;
        }).catch(() => caches.match('/').then(c => c || fetch(e.request)))
      );
      return;
    }
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(c => c || caches.match('/')).then(c => c || new Response( // vidme-v2.3-sw: inline fallback — precache may be empty
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Vidme</title></head><body style="background:#0f172a;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:1.5rem;margin-bottom:0.5rem">Offline</h1><p style="color:#94a3b8">Waiting for connection&hellip;</p><script>setTimeout(()=>location.reload(),3000)<\/script></div></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    )))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.status === 200 && e.request.method === 'GET') {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, resClone));
      }
      return res;
    }).catch(() => cached))
  );
});
