import { $, state } from './state.js';
import { esc } from './utils.js';

export function toast(msg, type = 'info', duration = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span style="flex:1">${msg}</span><button onclick="this.parentElement.remove()" style="opacity:.6;font-size:18px;line-height:1;background:none;border:none;color:inherit;cursor:pointer">&times;</button>`;
  $('#toastContainer').appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  if (duration > 0) setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
  return el;
}

export function toastUpload(title) {
  const el = document.createElement('div');
  el.className = 'toast info';
  el.style.flexDirection = 'column';
  el.style.alignItems = 'stretch';
  el.style.gap = '8px';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <div class="vidme-loader"></div>
      <span style="flex:1;font-size:13px">Uploading <b>${esc(title)}</b></span>
      <span class="upload-pct" style="font-size:12px;opacity:.7">0%</span>
    </div>
    <div class="vidme-bar-bg">
      <div class="upload-bar vidme-bar">
        <div class="vidme-bar-stripes">
          <div class="vidme-bar-stripe"></div>
          <div class="vidme-bar-stripe"></div>
          <div class="vidme-bar-stripe"></div>
        </div>
      </div>
    </div>`;
  $('#toastContainer').appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  return {
    progress(pct) {
      el.querySelector('.upload-bar').style.width = pct + '%';
      el.querySelector('.upload-pct').textContent = Math.round(pct) + '%';
    },
    done(ok, msg) {
      el.remove();
      toast(ok ? `✓ ${msg}` : `✗ ${msg}`, ok ? 'success' : 'error', ok ? 4000 : 6000);
    }
  };
}

export function showPrompt(title, placeholder = '') {
  return new Promise(resolve => {
    $('#promptTitle').textContent = title;
    $('#promptInput').placeholder = placeholder;
    $('#promptInput').value = '';
    $('#promptModal').classList.replace('hidden', 'flex');
    setTimeout(() => $('#promptInput').focus(), 50);
    const cleanup = val => { $('#promptModal').classList.replace('flex', 'hidden'); resolve(val); };
    $('#promptOk').onclick = () => cleanup($('#promptInput').value.trim() || null);
    $('#promptCancel').onclick = () => cleanup(null);
    $('#promptInput').onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); cleanup($('#promptInput').value.trim() || null); }
      if (e.key === 'Escape') cleanup(null);
    };
  });
}

export function showConfirm(title, msg) {
  return new Promise(resolve => {
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = msg;
    $('#confirmModal').classList.replace('hidden', 'flex');
    const cleanup = val => { $('#confirmModal').classList.replace('flex', 'hidden'); resolve(val); };
    $('#confirmOk').onclick = () => cleanup(true);
    $('#confirmCancel').onclick = () => cleanup(false);
  });
}

export function showFolderPicker(title) {
  return new Promise(resolve => {
    $('#folderPickerTitle').textContent = title;
    const list = $('#folderPickerList');
    list.innerHTML = '<button data-fid="" class="fp-opt w-full text-left px-3 py-2 rounded-lg hover:bg-slate-700 text-sm">No folder</button>' +
      state.folders.map(f => `<button data-fid="${f.id}" class="fp-opt w-full text-left px-3 py-2 rounded-lg hover:bg-slate-700 text-sm" style="padding-left:${12 + (f.depth||0) * 16}px">${'— '.repeat(f.depth||0)}${esc(f.name)}</button>`).join('');
    $('#folderPickerModal').classList.replace('hidden', 'flex');
    const cleanup = val => { $('#folderPickerModal').classList.replace('flex', 'hidden'); resolve(val); };
    document.querySelectorAll('.fp-opt').forEach(b => b.onclick = () => cleanup(b.dataset.fid || null));
    $('#folderPickerCancel').onclick = () => cleanup(undefined);
  });
}

export function openModal() {
  const card = $('#uploadForm');
  card.style.top = '50%';
  card.style.left = '50%';
  card.style.transform = 'translate(-50%, -50%)';
  $('#modal').style.display = 'block';
}

export function closeModal() {
  $('#modal').style.display = 'none';
  $('#uploadForm').reset();
  $('#fileName').textContent = 'Drop a video here or click to browse';
}

export function initDraggableModal() {
  const card = document.getElementById('uploadForm');
  const header = document.getElementById('modalHeader');
  const overlay = document.getElementById('modal');
  let dragging = false, sx, sy, sl, st;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  function start(clientX, clientY) {
    dragging = true;
    const rect = card.getBoundingClientRect();
    card.style.transform = 'none';
    sl = rect.left; st = rect.top;
    card.style.left = sl + 'px';
    card.style.top = st + 'px';
    sx = clientX; sy = clientY;
  }
  function move(clientX, clientY) {
    if (!dragging) return;
    let nl = sl + (clientX - sx), nt = st + (clientY - sy);
    const cw = card.offsetWidth, ch = card.offsetHeight;
    nl = Math.max(0, Math.min(nl, window.innerWidth - cw));
    nt = Math.max(0, Math.min(nt, window.innerHeight - ch));
    card.style.left = nl + 'px';
    card.style.top = nt + 'px';
  }
  function end() { dragging = false; }

  header.addEventListener('mousedown', e => { start(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => move(e.clientX, e.clientY));
  document.addEventListener('mouseup', end);
  header.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
  document.addEventListener('touchmove', e => { if (dragging) { e.preventDefault(); const t = e.touches[0]; move(t.clientX, t.clientY); } }, { passive: false });
  document.addEventListener('touchend', end);
}
