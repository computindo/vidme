import { $, state } from './state.js';
import { esc, slugify, uncategorizedCount, pageUrl, _pageParam } from './utils.js';
import { api } from './api.js';
import { toast, showPrompt, showConfirm, showFolderPicker } from './ui.js';
import { render, load } from './render.js';

export function toggleLibraryPanel() {
  const p = $('#libraryPanel');
  if (p.classList.contains('hidden')) {
    p.classList.replace('hidden', 'flex');
    renderLibraryPanel();
    requestAnimationFrame(() => p.classList.remove('translate-y-full'));
  } else {
    p.classList.add('translate-y-full');
    setTimeout(() => p.classList.replace('flex', 'hidden'), 300);
  }
}

export function selectFolder(id) {
  state.folder = id || null;
  state.page = 1;
  if (_pageParam()) history.replaceState({}, '', pageUrl(null));
  if (state.folder === 'null') $('#heading').textContent = 'Uncategorized';
  else if (state.folder === '__portrait__') $('#heading').textContent = 'Portrait';
  else if (state.folder === '__landscape__') $('#heading').textContent = 'Landscape';
  else {
    const folder = state.folders.find(f => f.id === id);
    $('#heading').textContent = folder ? folder.name : 'All videos';
  }
  if (state.folder === '__portrait__') {
    history.pushState({}, '', '/library/portrait/');
  } else if (state.folder === '__landscape__') {
    history.pushState({}, '', '/library/landscape/');
  } else if (state.folder === 'null') {
    history.pushState({}, '', '/library/uncategorized/');
  } else if (state.folder && !state.folder.startsWith('__')) {
    const _f = state.folders.find(f => f.id === state.folder);
    history.pushState({}, '', '/' + slugify(_f ? _f.name : state.folder) + '/');
  } else {
    history.pushState({}, '', '/');
  }
  render();
  requestAnimationFrame(() => window.scrollTo(0, 0));
  toggleLibraryPanel();
}

export function renderLibraryPanel() {
  const totalCount = state.videos.length;
  const uncCount = uncategorizedCount();
  let html = `<button onclick="selectFolder('')" class="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-800 border-b border-slate-800">
    <span class="material-symbols-outlined text-indigo-300">video_library</span>
    <span class="flex-1 text-left font-medium">All Videos</span>
    <span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs">${totalCount}</span>
  </button>`;
  html += `<button onclick="selectFolder('null')" class="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-800 border-b border-slate-800">
    <span class="material-symbols-outlined text-slate-400">folder_off</span>
    <span class="flex-1 text-left">Uncategorized</span>
    <span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">${uncCount}</span>
  </button>`;
  const portraitCount = state.videos.filter(v => v.is_portrait).length;
  html += `<button onclick="selectFolder('__portrait__')" class="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-800 border-b border-slate-800">
    <span class="material-symbols-outlined text-indigo-300">stay_current_portrait</span>
    <span class="flex-1 text-left">Portrait</span>
    <span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs">${portraitCount}</span>
  </button>`;
  html += `<button onclick="selectFolder('__landscape__')" class="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-800 border-b border-slate-800">
    <span class="material-symbols-outlined text-indigo-300">stay_current_landscape</span>
    <span class="flex-1 text-left">Landscape</span>
    <span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs">${state.videos.length - portraitCount}</span>
  </button>`;
  function renderItem(f, depth) {
    const icon = depth > 0 ? 'subdirectory_arrow_right' : 'folder';
    const pad = 16 + depth * 20;
    let h = `<div class="flex w-full items-center border-b border-slate-800 hover:bg-slate-800" style="padding-left:${pad}px">
      <button onclick="selectFolder('${f.id}')" class="flex flex-1 items-center gap-3 py-3 px-4 text-left">
        <span class="material-symbols-outlined text-slate-400">${icon}</span>
        <span class="flex-1">${esc(f.name)}</span>
        <span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">${f.video_count}</span>
      </button>
      <button onclick="event.stopPropagation();showCtxMenu(event,'${f.id}')" class="px-3 py-2 text-slate-500 hover:text-slate-200"><span class="material-symbols-outlined" style="font-size:18px">more_vert</span></button>
    </div>`;
    if (f.children) h += f.children.map(c => renderItem(c, depth + 1)).join('');
    return h;
  }
  html += (state.folderTree || []).map(f => renderItem(f, 0)).join('');
  $('#libraryList').innerHTML = html;
}

export function showCtxMenu(e, folderId) {
  const menu = $('#ctxMenu');
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;
  menu.innerHTML = `
    <button class="ctx-item flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-800" onclick="renameFolder('${folderId}')"><span class="material-symbols-outlined" style="font-size:18px">edit</span>Rename</button>
    <button class="ctx-item flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-800" onclick="moveFolder('${folderId}')"><span class="material-symbols-outlined" style="font-size:18px">drive_file_move</span>Move to folder</button>
    <div class="my-1 border-t border-slate-700"></div>
    <button class="ctx-item flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-slate-800" onclick="deleteFolder('${folderId}')"><span class="material-symbols-outlined" style="font-size:18px">delete</span>Delete</button>`;
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px';
  menu.classList.remove('hidden');
}

export async function renameFolder(id) {
  const folder = state.folders.find(f => f.id === id);
  if (!folder) return;
  const name = await showPrompt('Rename folder', 'Folder name');
  if (!name || name === folder.name) return;
  await api(`/api/folders/${id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
  toast(`Folder renamed to "${name}"`, 'success');
  await load();
}

export async function moveFolder(id) {
  const folder = state.folders.find(f => f.id === id);
  if (!folder) return;
  const targetId = await showFolderPicker('Move folder to');
  if (targetId === undefined) return;
  await api(`/api/folders/${id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ parent_id: targetId || null }) });
  toast(`Folder moved`, 'success');
  await load();
}

export async function deleteFolder(id) {
  const folder = state.folders.find(f => f.id === id);
  if (!folder) return;
  const hasVideos = folder.video_count > 0;
  const hasChildren = state.folders.some(f => f.parent_id === id);
  let url = `/api/folders/${id}`;
  if (hasVideos || hasChildren) {
    const parts = [];
    if (hasVideos) parts.push(`${folder.video_count} video${folder.video_count===1?'':'s'}`);
    if (hasChildren) parts.push('subfolders');
    const ok = await showConfirm('Delete folder', `"${folder.name}" has ${parts.join(' and ')}.\n\nClick Delete to move them to Uncategorized, or Cancel to abort.`);
    if (!ok) return;
    url += '?orphan_action=unassign';
  }
  await fetch(url, { method: 'DELETE' });
  toast(`Folder "${folder.name}" deleted`, 'success');
  if (state.folder === id) { state.folder = null; $('#heading').textContent = 'All videos'; }
  await load();
}

export async function createNewFolder() {
  const name = await showPrompt('New folder', 'Folder name');
  if (!name) return;
  const currentFolder = (state.folder && !state.folder.startsWith('__') && state.folder !== 'null') ? state.folder : null;
  await api('/api/folders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, parent_id: currentFolder }) });
  toast(`Folder "${name}" created`, 'success');
  await load();
}

export function initLibraryContextMenu() {
  document.addEventListener('click', () => {
    const m = $('#ctxMenu');
    if (m) m.classList.add('hidden');
  });
  const menu = $('#ctxMenu');
  if (menu) menu.addEventListener('click', e => e.stopPropagation());
}
