import { $, state } from './state.js';
import { esc } from './utils.js';
import { idbPut, idbDel, setIdbPutHook } from './api.js';
import { toast, toastUpload, closeModal } from './ui.js';
import { load } from './render.js';

export function toggleUploadCenter() {
  const p = $('#uploadCenter');
  if (p.classList.contains('hidden')) {
    p.classList.replace('hidden', 'flex');
    renderUploadCenter();
    requestAnimationFrame(() => p.style.transform = 'translateY(0)');
  } else {
    p.style.transform = 'translateY(100%)';
    setTimeout(() => p.classList.replace('flex', 'hidden'), 300);
  }
}

export function updateUploadBadge() {
  const active = state.uploads.filter(u => u.status === 'uploading').length;
  for (const id of ['uploadBadge', 'uploadBadgeDesktop']) {
    const badge = $('#' + id);
    if (!badge) continue;
    if (active > 0) { badge.textContent = active; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }
}

export function fmtEta(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  sec = Math.round(sec);
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec/60) + 'm ' + String(sec%60).padStart(2,'0') + 's';
  return Math.floor(sec/3600) + 'h ' + String(Math.floor((sec%3600)/60)).padStart(2,'0') + 'm';
}

export function etaHtml(u) {
  const now = Date.now();
  let curSent = u.bytesSent || 0;
  if (u._anchorAt && u.speed && u.speed > 0) {
    const dt = (now - u._anchorAt) / 1000;
    curSent = Math.min(u.bytesTotal || curSent, Math.round((u.bytesSent || 0) + u.speed * dt));
  }
  const remBytes = (u.bytesTotal && curSent) ? Math.max(0, u.bytesTotal - curSent) : null;
  const etaSec = (remBytes != null && u.speed && u.speed > 0) ? remBytes / u.speed : null;
  const speedStr = (u.speed && u.speed > 0) ? (u.speed >= 1048576 ? (u.speed/1048576).toFixed(1) + ' MB/s' : (u.speed/1024).toFixed(0) + ' KB/s') : null;
  const etaStr = fmtEta(etaSec);
  const sentMB = curSent ? (curSent/1048576).toFixed(1) : '0';
  const totalMB = u.bytesTotal ? (u.bytesTotal/1048576).toFixed(1) + ' MB' : '';
  let sub = `${sentMB}${totalMB ? ' / ' + totalMB : ' MB'}`;
  if (speedStr) sub += ` &bull; ${speedStr}`;
  if (etaStr) sub += ` &bull; ~${etaStr} left`;
  return sub;
}

let _uploadDirty = false;
export function markUploadsDirty() {
  _uploadDirty = true;
}

export function renderUploadCenter() {
  _uploadDirty = false;
  const list = $('#uploadList');
  if (!list) return;
  if (!state.uploads.length) {
    list.innerHTML = '<div class="py-8 text-center text-sm text-slate-500">No recent uploads</div>';
    return;
  }
  list.innerHTML = state.uploads.slice().reverse().map(u => {
    const isUp = u.status === 'uploading';
    const isDone = u.status === 'done';
    const isErr = u.status === 'error';
    const isStall = u.status === 'stalled';
    let icon = 'cloud_upload', iconColor = 'text-indigo-400';
    if (isDone) { icon = 'check_circle'; iconColor = 'text-emerald-400'; }
    if (isErr) { icon = 'error'; iconColor = 'text-red-400'; }
    if (isStall) { icon = 'cloud_off'; iconColor = 'text-amber-400'; }
    const sub = isUp ? etaHtml(u) : isDone ? 'Completed' : isStall ? 'Stalled — waiting for network' : isErr ? 'Failed' : '';
    const pct = isDone ? 100 : Math.round(u.progress || 0);
    return `<div class="rounded-xl bg-slate-800/60 p-3">
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined ${iconColor}" style="font-size:22px">${icon}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-slate-200">${esc(u.title)}</div>
          <div class="text-xs text-slate-400">${sub}</div>
        </div>
        <span class="text-xs font-semibold text-slate-300">${pct}%</span>
        ${isUp ? `<button onclick="cancelUpload('${u.id}')" class="ml-1 rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-red-400" title="Cancel upload"><span class="material-symbols-outlined" style="font-size:16px">close</span></button>` : ''}
      </div>
      ${isUp ? `<div class="vidme-bar-bg mt-2.5">
        <div class="vidme-bar" style="width:${pct}%">
          <div class="vidme-bar-stripes">
            <div class="vidme-bar-stripe"></div>
            <div class="vidme-bar-stripe"></div>
            <div class="vidme-bar-stripe"></div>
          </div>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

export function cancelUpload(uploadId) {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'sw-upload-cancel', uploadId });
  }
  idbDel(uploadId).catch(() => {});
  _idbQueue = _idbQueue.filter(r => r.uploadId !== uploadId);
  if (_activeUploads > 0) _activeUploads--;
  pumpQueue();
  const u = state.uploads.find(x => x.id === uploadId);
  if (u) { u.status = 'cancelled'; u.progress = 0; renderUploadCenter(); }
  updateUploadBadge();
}

export function clearUploadHistory() {
  state.uploads = state.uploads.filter(u => u.status === 'uploading');
  renderUploadCenter();
  updateUploadBadge();
}

// ── Codec Gate (Client-side pre-detection) ──
export async function detectVideoCodec(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const readSlice = (start, length) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => resolve(null);
    r.readAsArrayBuffer(file.slice(start, start + length));
  });

  if (['mp4', 'm4v', 'mov'].includes(ext)) {
    const head = await readSlice(0, Math.min(file.size, 1048576));
    if (!head || head.length < 8) return { ok: false, reason: 'unreadable' };
    const hStr = Array.from(head.slice(0, 512)).map(b => String.fromCharCode(b)).join('');
    if (!hStr.includes('ftyp') && !hStr.includes('moov')) return { ok: false, reason: 'invalid-container' };

    const passes = ['avc1', 'avc3', 'avc4', 'h264'];
    const rejects = ['hvc1', 'hev1', 'dvh1', 'dvhe', 'av01', 'vp09', 'vp08', 'mp4v', 's263', 'vc-1', 'xvid', 'divx'];
    let foundReject = null;

    for (let i = 0; i < head.length - 4; i++) {
      const four = String.fromCharCode(head[i], head[i+1], head[i+2], head[i+3]);
      if (passes.includes(four)) return { ok: true, codec: four };
      if (!foundReject && rejects.includes(four)) foundReject = four;
    }
    if (file.size > 2097152) {
      const tail = await readSlice(file.size - 1048576, 1048576);
      if (tail) {
        for (let i = 0; i < tail.length - 4; i++) {
          const four = String.fromCharCode(tail[i], tail[i+1], tail[i+2], tail[i+3]);
          if (passes.includes(four)) return { ok: true, codec: four };
          if (!foundReject && rejects.includes(four)) foundReject = four;
        }
      }
    }
    if (foundReject) return { ok: false, codec: foundReject, reason: 'codec-rejected' };
    return { ok: false, reason: 'codec-unknown' };
  }

  if (['mkv'].includes(ext)) {
    const head = await readSlice(0, Math.min(file.size, 1048576));
    if (!head) return { ok: false, reason: 'unreadable' };
    const s = Array.from(head).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : ' ').join('');
    if (s.includes('V_MPEG4/ISO/AVC')) return { ok: true, codec: 'h264' };
    if (s.includes('V_MPEGH/ISO/HEVC') || s.includes('V_MS/VFW/FOURCC/HVC1') || s.includes('V_MS/VFW/FOURCC/HEVC')) return { ok: false, codec: 'hevc', reason: 'codec-rejected' };
    if (s.includes('V_AV1')) return { ok: false, codec: 'av1', reason: 'codec-rejected' };
    if (s.includes('V_VP9')) return { ok: false, codec: 'vp9', reason: 'codec-rejected' };
    if (s.includes('V_VP8')) return { ok: false, codec: 'vp8', reason: 'codec-rejected' };
    return { ok: false, reason: 'codec-unknown' };
  }

  if (['avi'].includes(ext)) {
    const head = await readSlice(0, Math.min(file.size, 65536));
    if (!head) return { ok: false, reason: 'unreadable' };
    const s = Array.from(head.slice(0, 4096)).map(b => String.fromCharCode(b)).join('');
    if (/H264|h264|X264|x264|AVC1|avc1/.test(s)) return { ok: true, codec: 'h264' };
    return { ok: false, reason: 'codec-rejected' };
  }

  if (['flv'].includes(ext)) {
    const head = await readSlice(0, 1024);
    if (!head || head.length < 13) return { ok: false, reason: 'unreadable' };
    for (let i = 9; i < head.length - 4; i++) {
      if ((head[i] & 0x1F) === 9) {
        const codecId = head[i + 11] & 0x0F;
        if (codecId === 7) return { ok: true, codec: 'h264' };
        if (codecId === 12) return { ok: false, codec: 'hevc', reason: 'codec-rejected' };
        return { ok: false, reason: 'codec-rejected' };
      }
    }
    return { ok: false, reason: 'codec-unknown' };
  }

  if (['ts', 'm2ts', 'mts'].includes(ext)) {
    const head = await readSlice(0, Math.min(file.size, 131072));
    if (!head) return { ok: false, reason: 'unreadable' };
    const types = tsStreamTypes(head);
    if (types.includes(0x1B)) return { ok: true, codec: 'h264' };
    if (types.includes(0x24) || types.includes(0x35)) return { ok: false, codec: 'hevc', reason: 'codec-rejected' };
    if (types.length) return { ok: false, reason: 'codec-rejected' };
    return { ok: false, reason: 'codec-unknown' };
  }

  if (['webm'].includes(ext)) return { ok: false, codec: 'vp8/vp9/av1', reason: 'codec-rejected' };
  if (['wmv', 'asf', 'rm', 'rmvb', 'vob', 'ogv', '3gp'].includes(ext)) return { ok: false, codec: ext, reason: 'codec-rejected' };

  return { ok: false, reason: 'extension-unsupported' };
}

export function tsStreamTypes(buf) {
  const types = [];
  let pmtPid = null;
  for (let i = 0; i <= buf.length - 188; i += 188) {
    if (buf[i] !== 0x47) continue;
    const pid = ((buf[i+1] & 0x1F) << 8) | buf[i+2];
    const payloadStart = (buf[i+1] & 0x40) !== 0;
    let offset = i + 4;
    const afc = (buf[i+3] >> 4) & 3;
    if (afc === 2) continue;
    if (afc === 3) offset += 1 + buf[offset];
    if (offset >= i + 188) continue;
    if (payloadStart) offset += 1 + buf[offset];
    if (pid === 0 && pmtPid === null) {
      if (offset + 12 <= i + 188) pmtPid = ((buf[offset + 10] & 0x1F) << 8) | buf[offset + 11];
    } else if (pid === pmtPid && pmtPid !== null) {
      if (offset + 4 <= i + 188) {
        const secLen = ((buf[offset + 1] & 0x0F) << 8) | buf[offset + 2];
        const progInfoLen = ((buf[offset + 8] & 0x0F) << 8) | buf[offset + 9];
        let pos = offset + 10 + progInfoLen;
        const end = offset + 3 + secLen - 4;
        while (pos + 5 <= end && pos + 5 <= i + 188) {
          types.push(buf[pos]);
          const esInfoLen = ((buf[pos + 3] & 0x0F) << 8) | buf[pos + 4];
          pos += 5 + esInfoLen;
        }
      }
      break;
    }
  }
  return types;
}

export function codecGateToast(res) {
  if (res.reason === 'codec-rejected') {
    const c = (res.codec || 'non-H.264').toUpperCase();
    toast(`<b>Upload ditolak:</b> Format codec <b>${esc(c)}</b> tidak didukung.<br><span style="opacity:.8;font-size:11px">Server hanya menerima video dengan codec <b>H.264 (AVC)</b>. Silakan convert dulu ke H.264 MP4.</span>`, 'error', 8000);
  } else if (res.reason === 'extension-unsupported') {
    toast(`<b>Upload ditolak:</b> Format file tidak didukung. Hanya video <b>H.264 (MP4/MKV/MOV)</b> yang diterima.`, 'error', 7000);
  } else {
    toast(`<b>Upload ditolak:</b> Video tidak valid atau codec tidak terbaca. Pastikan file berformat H.264.`, 'error', 7000);
  }
}

// ── Sequential Queue ──
export let _idbQueue = [];
export let _activeUploads = 0;
export const MAX_CONCURRENT_UPLOADS = 1;

export function pumpQueue() {
  if (_activeUploads >= MAX_CONCURRENT_UPLOADS || _idbQueue.length === 0) return;
  const next = _idbQueue.shift();
  _activeUploads++;
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'sw-upload-resume', uploadId: next.uploadId });
    markUploadsDirty();
    toast(`Uploading (${_activeUploads}/${_activeUploads + _idbQueue.length}): <b>${esc(next.title)}</b>`, 'info');
  }
}

export function initUploadQueue() {
  setIdbPutHook(async function(k, v, rawPut) {
    await rawPut(k, v);
    if (v && v.status === 'uploading') {
      const existing = _idbQueue.find(r => r.uploadId === v.uploadId);
      if (!existing && !state.uploads.some(u => u.id === v.uploadId && u.status === 'uploading' && _activeUploads > 0)) {
        _idbQueue.push({ uploadId: v.uploadId, title: v.title });
        pumpQueue();
      }
    }
  });
}

export function initUploadForm() {
  const fileInput = document.getElementById('file');
  const fileName = document.getElementById('fileName');
  const dropZone = document.getElementById('dropZone');
  const uploadForm = document.getElementById('uploadForm');

  if (fileInput) {
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) { fileName.textContent = 'Drop a video here or click to browse'; return; }
      if (files.length === 1) {
        fileName.textContent = files[0].name;
        const check = await detectVideoCodec(files[0]);
        if (!check.ok) { codecGateToast(check); fileInput.value = ''; fileName.textContent = 'Drop a video here or click to browse'; }
      } else {
        fileName.textContent = `${files.length} videos selected`;
        for (const f of files) {
          const check = await detectVideoCodec(f);
          if (!check.ok) { codecGateToast(check); fileInput.value = ''; fileName.textContent = 'Drop a video here or click to browse'; return; }
        }
      }
    };
  }

  if (dropZone) {
    dropZone.ondragover = e => { e.preventDefault(); dropZone.classList.add('border-indigo-400'); };
    dropZone.ondragleave = () => dropZone.classList.remove('border-indigo-400');
    dropZone.ondrop = async e => {
      e.preventDefault();
      dropZone.classList.remove('border-indigo-400');
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('video/') || /\.(mp4|mkv|mov|avi|webm|ts|m2ts)$/i.test(f.name));
      if (!files.length) return;
      for (const f of files) {
        const check = await detectVideoCodec(f);
        if (!check.ok) { codecGateToast(check); return; }
      }
      fileInput.files = e.dataTransfer.files;
      fileName.textContent = files.length === 1 ? files[0].name : `${files.length} videos selected`;
    };
  }

  if (uploadForm) {
    uploadForm.onsubmit = async e => {
      e.preventDefault();
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;
      const fVal = $('#folderSelect').value;
      const folderId = (fVal && fVal !== 'null' && !fVal.startsWith('__')) ? fVal : ((state.folder && !state.folder.startsWith('__') && state.folder !== 'null') ? state.folder : '');

      for (const f of files) {
        const check = await detectVideoCodec(f);
        if (!check.ok) { codecGateToast(check); return; }
      }

      closeModal();
      for (const file of files) {
        const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const title = files.length === 1 ? ($('#titleInput').value.trim() || file.name.replace(/\.[^/.]+$/, '')) : file.name.replace(/\.[^/.]+$/, '');
        const record = { uploadId, file, title, folderId, status: 'uploading', progress: 0, startedAt: Date.now() };
        await idbPut(uploadId, record);
        state.uploads.push({ id: uploadId, title, status: 'uploading', progress: 0, timestamp: null });
        updateUploadBadge();
        renderUploadCenter();
      }
    };
  }
}
