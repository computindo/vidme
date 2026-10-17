import { $, state, PAGE_SIZE } from './state.js';
import { esc, fmt, suggestedVideos, pageUrl, _pageParam, clampPage } from './utils.js';
import { api } from './api.js';
import { toast, showConfirm, showFolderPicker } from './ui.js';
import { openVideo, Router } from './router.js';
import { stopPreview } from './sidebar.js';

export function setSelectMode(on) {
  state.selectMode = on;
  state.selected.clear();
  document.body.classList.toggle('select-mode', on);
  $('#selBar').style.display = on ? 'flex' : 'none';
  $('#enterSelBtn').style.display = on ? 'none' : 'flex';
  updateSelBar();
  document.querySelectorAll('.video-card').forEach(el => {
    el.classList.toggle('selecting', on);
    el.classList.remove('selected');
    const cb = el.querySelector('.card-select-cb');
    if (cb) cb.checked = false;
  });
}

export function updateSelBar() {
  const n = state.selected.size;
  $('#selCount').textContent = `${n} selected`;
  const disable = n === 0;
  for (const id of ['bulkMoveBtn', 'bulkDownloadBtn', 'bulkDeleteBtn']) {
    const btn = $('#' + id);
    if (btn) btn.disabled = disable;
  }
}

export function toggleSelect(id) {
  if (!state.selectMode) return;
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  const cardEl = document.querySelector(`.video-card[data-id="${id}"]`);
  if (cardEl) {
    const isSel = state.selected.has(id);
    cardEl.classList.toggle('selected', isSel);
    const cb = cardEl.querySelector('.card-select-cb');
    if (cb) cb.checked = isSel;
  }
  updateSelBar();
}

export function initBatchActions() {
  const selectAllBtn = $('#selectAllBtn');
  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      const q = $('#search').value.trim().toLowerCase();
      let vs = state.videos;
      if (state.folder === '__portrait__') vs = vs.filter(v => v.is_portrait);
      else if (state.folder === '__landscape__') vs = vs.filter(v => !v.is_portrait);
      else if (state.folder === 'null') vs = vs.filter(v => !v.folder_id);
      else if (state.folder) vs = vs.filter(v => v.folder_id === state.folder);
      if (q) vs = vs.filter(v => v.title.toLowerCase().includes(q));
      const allSelected = vs.every(v => state.selected.has(v.id));
      if (allSelected) {
        state.selected.clear();
        document.querySelectorAll('.video-card').forEach(el => {
          el.classList.remove('selected');
          const cb = el.querySelector('.card-select-cb');
          if (cb) cb.checked = false;
        });
      } else {
        vs.forEach(v => state.selected.add(v.id));
        document.querySelectorAll('.video-card').forEach(el => {
          el.classList.add('selected');
          const cb = el.querySelector('.card-select-cb');
          if (cb) cb.checked = true;
        });
      }
      updateSelBar();
    };
  }

  const cancelSelBtn = $('#cancelSelBtn');
  if (cancelSelBtn) cancelSelBtn.onclick = () => setSelectMode(false);

  const bulkMoveBtn = $('#bulkMoveBtn');
  if (bulkMoveBtn) {
    bulkMoveBtn.onclick = async () => {
      const ids = Array.from(state.selected);
      if (!ids.length) return;
      const targetId = await showFolderPicker('Move selected videos to');
      if (targetId === undefined) return;
      await api('/api/videos/bulk-move', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ids, folder_id: targetId || null }) });
      toast(`${ids.length} video(s) moved`, 'success');
      setSelectMode(false);
      await load();
    };
  }

  const bulkDownloadBtn = $('#bulkDownloadBtn');
  if (bulkDownloadBtn) {
    bulkDownloadBtn.onclick = async () => {
      const ids = Array.from(state.selected);
      if (!ids.length) return;
      const r = await fetch('/api/videos/bulk-download', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ids }) });
      if (!r.ok) { toast('Bulk download failed', 'error'); return; }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vidme_download_${Date.now()}.zip`;
      a.click();
      setSelectMode(false);
    };
  }

  const bulkDeleteBtn = $('#bulkDeleteBtn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.onclick = async () => {
      const ids = Array.from(state.selected);
      if (!ids.length) return;
      const ok = await showConfirm('Delete videos', `Are you sure you want to delete ${ids.length} video(s)? This cannot be undone.`);
      if (!ok) return;
      await api('/api/videos/bulk-delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ids }) });
      toast(`${ids.length} video(s) deleted`, 'success');
      setSelectMode(false);
      await load();
    };
  }
}

export function card(v) {
  const isSelected = state.selected.has(v.id);
  const isProc = v.status === 'processing';
  const isErr = v.status === 'error';
  const dur = v.duration ? fmt(v.duration) : '';
  const isPortrait = !!v.is_portrait;
  const frameClass = isPortrait ? 'frame-portrait' : 'frame-landscape';
  const ratioLabel = isPortrait ? '<span class="rounded bg-indigo-900/80 px-1 py-0.5 text-[10px] font-bold tracking-wider text-indigo-200">PORTRAIT</span>' : '';
  return `
  <article class="video-card ${isPortrait ? 'card-portrait' : 'card-landscape'} ${state.selectMode ? 'selecting' : ''} ${isSelected ? 'selected' : ''}"
           data-id="${v.id}" data-portrait="${isPortrait?1:0}" ${v.folder_id ? `data-folder-id="${esc(v.folder_id)}"` : ''}
           ${v.has_microclip ? `data-clip="${v.id}"` : ''}
           onclick="${state.selectMode ? `toggleSelect('${v.id}')` : `openVideo('${v.id}', '${v.folder_id||''}')`}">
    <div class="video-frame ${frameClass}">
      ${v.status === 'ready'
        ? `<img src="/storyboard/${v.id}?v=${v.has_storyboard||0}" class="h-full w-full" loading="lazy" alt="${esc(v.title)}" onerror="if(!this._fallback){this._fallback=true;this.src='/thumb/${v.id}'}">`
        : isErr
        ? '<div class="flex h-full flex-col items-center justify-center text-red-400"><span class="material-symbols-outlined mb-1 text-3xl">error</span><span class="text-xs font-semibold">Error</span></div>'
        : '<div class="flex h-full flex-col items-center justify-center text-indigo-400"><div class="vidme-loader mb-2"></div><span class="text-xs font-semibold tracking-wide">Processing...</span></div>'}
      ${v.is_pinned ? '<span class="absolute left-2 top-2 rounded bg-indigo-500/80 p-1 text-xs leading-none shadow"><span class="material-symbols-outlined" style="font-size:14px">push_pin</span></span>' : ''}
      <div class="card-overlay absolute inset-0 bg-black/40 flex items-center justify-center">
        <span class="material-symbols-outlined play-btn text-white" style="font-size:48px">play_arrow</span>
      </div>
      ${v.status === 'ready' ? `<span class="badge absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-xs font-semibold shadow">${dur}</span>` : ''}
      <label class="card-select-btn" onclick="event.stopPropagation()">
        <input type="checkbox" class="card-select-cb" ${isSelected ? 'checked' : ''} onchange="toggleSelect('${v.id}')">
        <div class="card-select-icon"><span class="material-symbols-outlined" style="font-size:16px">check</span></div>
      </label>
    </div>
    <div class="p-3">
      <div class="flex items-center gap-1.5">${ratioLabel}<h3 class="flex-1 truncate font-semibold">${esc(v.title)}</h3></div>
      <p class="text-xs text-slate-400 mt-1">${new Date(v.created_at).toLocaleDateString()}</p>
    </div>
  </article>`;
}

export function renderFolders() {
  const current = state.folder;
  const countAll = state.videos.length;
  const uncCount = state.videos.filter(v => !v.folder_id).length;
  let html = `<button onclick="selectFolder('')" class="folder-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-left ${!current ? 'active font-medium' : 'text-slate-400'}">
    <span class="material-symbols-outlined text-base">video_library</span>
    <span class="flex-1 truncate">All videos</span>
    <span class="text-xs opacity-60">${countAll}</span>
  </button>`;
  html += `<button onclick="selectFolder('null')" class="folder-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-left ${current === 'null' ? 'active font-medium' : 'text-slate-400'}">
    <span class="material-symbols-outlined text-base">folder_off</span>
    <span class="flex-1 truncate">Uncategorized</span>
    <span class="text-xs opacity-60">${uncCount}</span>
  </button>`;
  const portraitCount = state.videos.filter(v => v.is_portrait).length;
  html += `<button onclick="selectFolder('__portrait__')" class="folder-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-left ${current === '__portrait__' ? 'active font-medium' : 'text-slate-400'}">
    <span class="material-symbols-outlined text-base">stay_current_portrait</span>
    <span class="flex-1 truncate">Portrait</span>
    <span class="text-xs opacity-60">${portraitCount}</span>
  </button>`;
  html += `<button onclick="selectFolder('__landscape__')" class="folder-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-left ${current === '__landscape__' ? 'active font-medium' : 'text-slate-400'}">
    <span class="material-symbols-outlined text-base">stay_current_landscape</span>
    <span class="flex-1 truncate">Landscape</span>
    <span class="text-xs opacity-60">${state.videos.length - portraitCount}</span>
  </button>`;
  html += renderTree(state.folderTree || [], 0);
  $('#folderList').innerHTML = html;

  const sel = $('#folderSelect');
  if (sel) {
    sel.innerHTML = '<option value="">(Current folder)</option><option value="null">Uncategorized</option>' +
      (state.folders || []).map(f => `<option value="${f.id}" ${f.id === current ? 'selected' : ''}>${'— '.repeat(f.depth||0)}${esc(f.name)}</option>`).join('');
  }
}

export function renderTree(tree, depth) {
  const current = state.folder;
  let h = '';
  (tree || []).forEach(f => {
    const isActive = f.id === current;
    const pad = 12 + depth * 14;
    h += `<div class="group flex items-center rounded-xl ${isActive ? 'bg-indigo-600/20 text-indigo-300 font-medium' : 'hover:bg-slate-800 text-slate-400'}" style="padding-left:${pad}px">
      <button onclick="selectFolder('${f.id}')" class="flex flex-1 items-center gap-2 py-2 pr-1 text-sm text-left truncate">
        <span class="material-symbols-outlined text-base">${depth > 0 ? 'subdirectory_arrow_right' : 'folder'}</span>
        <span class="flex-1 truncate">${esc(f.name)}</span>
        <span class="text-xs opacity-60 pr-2">${f.video_count}</span>
      </button>
      <button onclick="event.stopPropagation();showCtxMenu(event,'${f.id}')" class="opacity-0 group-hover:opacity-100 p-1 mr-1 text-slate-500 hover:text-slate-200"><span class="material-symbols-outlined" style="font-size:16px">more_vert</span></button>
    </div>`;
    if (f.children && f.children.length) h += renderTree(f.children, depth + 1);
  });
  return h;
}

export function _restoreV(id) {
  const v = state.videos.find(x => x.id === id);
  if (!v) return;
  const els = document.querySelectorAll(`.video-card[data-id="${id}"]`);
  if (els.length) els.forEach(el => { el.outerHTML = card(v); });
  else render();
}

export function render() {
  const q = $('#search').value.trim().toLowerCase();
  const clearBtn = document.querySelector('.search-clear');
  const clearBtnMob = document.querySelector('.search-clear-mob');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  if (clearBtnMob) clearBtnMob.style.display = q ? 'block' : 'none';

  let vs = state.videos;
  if (state.folder === '__portrait__') vs = vs.filter(v => v.is_portrait);
  else if (state.folder === '__landscape__') vs = vs.filter(v => !v.is_portrait);
  else if (state.folder === 'null') vs = vs.filter(v => !v.folder_id);
  else if (state.folder) vs = vs.filter(v => v.folder_id === state.folder);
  if (q) vs = vs.filter(v => v.title.toLowerCase().includes(q));

  const pageMode = !state.folder && !q && _pageParam() !== null;
  const isHomeLanding = !state.folder && !q && !pageMode;
  const countEl = $('#count');
  if (countEl) countEl.textContent = `${vs.length} video${vs.length === 1 ? '' : 's'}`;

  if (isHomeLanding) {
    const pinned = vs.filter(v => v.is_pinned);
    const recent = vs.slice(0, 10);
    const suggested = suggestedVideos(vs);
    let html = '';

    if (pinned.length) {
      html += `<div class="mb-10"><h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-slate-200"><span class="material-symbols-outlined text-indigo-400">push_pin</span> Pinned</h2><div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">${pinned.map(card).join('')}</div></div>`;
    }
    if (recent.length) {
      html += `<div class="mb-10 recent-section">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="flex items-center gap-2 text-lg font-bold text-slate-200"><span class="material-symbols-outlined text-indigo-400">schedule</span> Recent Uploads</h2>
          <span class="recent-counter text-xs font-semibold text-slate-400">1 / ${recent.length}</span>
        </div>
        <div class="recent-carousel-wrap">
          <div class="recent-slides">${recent.map(v => `<div class="recent-slide-hero">${card(v)}</div>`).join('')}</div>
          <button class="recent-prev" aria-label="Previous slide"><span class="material-symbols-outlined">chevron_left</span></button>
          <button class="recent-next" aria-label="Next slide"><span class="material-symbols-outlined">chevron_right</span></button>
          <div class="recent-dots">${recent.map((_, i) => `<button class="recent-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></button>`).join('')}</div>
        </div>
      </div>`;
    }
    if (suggested.length) {
      html += `<div class="mb-10">
        <h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-slate-200"><span class="material-symbols-outlined text-indigo-400">auto_awesome</span> Suggested</h2>
        <div class="sugg-grid grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">${suggested.map(card).join('')}</div>
        <div class="mt-8 flex justify-center">
          <button onclick="history.pushState({}, '', pageUrl(1)); Router.renderRoute();" class="explore-btn flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-white shadow-lg transition-all hover:scale-105">
            <span class="material-symbols-outlined">explore</span> Explore All Videos
          </button>
        </div>
      </div>`;
    }
    $('#videos').innerHTML = html || '<div class="py-12 text-center text-slate-500">No videos found</div>';
    initRecentNav();
    return;
  }

  if (pageMode) {
    const unpinned = vs.filter(v => !v.is_pinned);
    const totalPages = Math.ceil(unpinned.length / PAGE_SIZE) || 1;
    clampPage(totalPages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageVs = unpinned.slice(start, start + PAGE_SIZE);
    let html = `<div class="mb-8"><div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">${pageVs.map(card).join('')}</div></div>`;
    html += paginationBar(unpinned.length, state.page, PAGE_SIZE);
    $('#videos').innerHTML = html;
    initPagination();
    return;
  }

  const portrait = vs.filter(v => v.is_portrait);
  const landscape = vs.filter(v => !v.is_portrait);
  let html = '';
  if (portrait.length) html += `<div class="mb-8"><h2 class="mb-4 text-base font-bold text-slate-300">Portrait (${portrait.length})</h2><div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">${portrait.map(card).join('')}</div></div>`;
  if (landscape.length) html += `<div class="mb-8"><h2 class="mb-4 text-base font-bold text-slate-300">Landscape (${landscape.length})</h2><div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">${landscape.map(card).join('')}</div></div>`;
  $('#videos').innerHTML = html || '<div class="py-12 text-center text-slate-500">No videos found</div>';
}

export function paginationBar(total, current, size) {
  const totalPages = Math.ceil(total / size) || 1;
  if (totalPages <= 1) return '';
  let html = '<div class="j-pagination flex items-center justify-center gap-1.5 py-8">';
  html += `<button class="p-btn p-prev ${current === 1 ? 'disabled' : ''}" data-p="${current - 1}"><span class="material-symbols-outlined">chevron_left</span></button>`;
  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (current > 4) pages.push('...');
    const s = Math.max(2, current - 1), e = Math.min(totalPages - 1, current + 1);
    for (let i = s; i <= e; i++) pages.push(i);
    if (current < totalPages - 3) pages.push('...');
    pages.push(totalPages);
  }
  pages.forEach(p => {
    if (p === '...') html += '<span class="px-2 text-slate-500">...</span>';
    else html += `<button class="p-btn ${p === current ? 'active' : ''}" data-p="${p}">${p}</button>`;
  });
  html += `<button class="p-btn p-next ${current === totalPages ? 'disabled' : ''}" data-p="${current + 1}"><span class="material-symbols-outlined">chevron_right</span></button>`;
  html += '</div>';
  return html;
}

export function _onPageRenderable(id) {
  const cardEl = document.querySelector(`.video-card[data-id="${id}"]`);
  return !!cardEl;
}

export function initPagination() {
  document.querySelectorAll('.p-btn:not(.disabled)').forEach(b => {
    b.onclick = () => {
      const p = parseInt(b.dataset.p, 10);
      if (Number.isFinite(p)) {
        history.pushState({}, '', pageUrl(p));
        Router.renderRoute();
      }
    };
  });
}

export function initRecentNav() {
  const track = document.querySelector('.recent-slides');
  if (!track) return;
  const wrap = track.closest('.recent-carousel-wrap') || track.parentElement;
  const prev = wrap.querySelector('.recent-prev');
  const next = wrap.querySelector('.recent-next');
  const counter = wrap.parentElement.querySelector('.recent-counter');
  const dots = Array.from(wrap.querySelectorAll('.recent-dot'));
  const slides = Array.from(track.children);
  const n = slides.length;
  if (n <= 1) return;

  let pending = null;
  const width = () => slides[0].offsetWidth || track.offsetWidth;
  const liveIndex = () => Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / width())));
  const currentIndex = () => pending ?? liveIndex();

  const paint = idx => {
    if (counter) counter.textContent = `${idx + 1} / ${n}`;
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  };

  const go = idx => {
    pending = idx;
    paint(idx);
    track.scrollTo({ left: idx * width(), behavior: 'smooth' });
  };

  if (prev) prev.onclick = () => {
    const cur = currentIndex();
    go(cur === 0 ? n - 1 : cur - 1);
  };
  if (next) next.onclick = () => {
    const cur = currentIndex();
    go(cur === n - 1 ? 0 : cur + 1);
  };
  dots.forEach(d => {
    d.onclick = () => {
      const idx = parseInt(d.dataset.idx, 10);
      if (Number.isFinite(idx)) go(idx);
    };
  });

  let scrollTimer = null;
  track.onscroll = () => {
    if (pending === null) paint(liveIndex());
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      pending = null;
      paint(liveIndex());
    }, 120);
  };
}

export function clearSearch(mode) {
  const inp = mode === 'mobile' ? document.getElementById('mobileSearchInput') : document.getElementById('search');
  if (inp) inp.value = '';
  const other = mode === 'mobile' ? document.getElementById('search') : document.getElementById('mobileSearchInput');
  if (other) other.value = '';
  render();
}

export async function load() {
  try {
    const [videos, folders] = await Promise.all([api('/api/videos'), api('/api/folders')]);
    state.videos = videos;
    state.folders = folders;
    state.folderTree = (function buildTree(list, pid = null) {
      return list.filter(f => (f.parent_id || null) === pid).map(f => ({ ...f, children: buildTree(list, f.id) }));
    })(folders);
    renderFolders();
    render();
    poll();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

export function _vidSettled(v) {
  return v.status === 'ready' && v.has_storyboard === 1 && v.has_microclip === 1;
}

let pollTimer = null;
export function poll() {
  clearTimeout(pollTimer);
  const needPoll = state.videos.some(v => v.status === 'processing' || !_vidSettled(v));
  if (!needPoll) return;
  pollTimer = setTimeout(async () => {
    try {
      const videos = await api('/api/videos');
      state.videos = videos;
      render();
      poll();
    } catch (e) {
      poll();
    }
  }, 3000);
}
