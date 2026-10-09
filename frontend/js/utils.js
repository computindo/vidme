import { state } from './state.js';

export function _pageParam() {
  const p = parseInt(new URLSearchParams(location.search).get('page'), 10);
  return Number.isFinite(p) && p >= 1 ? p : null;
}

export function pageUrl(n) {
  const u = new URL(location.href);
  if (n === null) u.searchParams.delete('page');
  else u.searchParams.set('page', String(n));
  return u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
}

export function clampPage(totalPages) {
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;
}

export function _seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function suggestedVideos(vs) {
  const pool = vs.filter(v => !v.is_pinned && v.status === 'ready');
  const seed = Math.floor(Date.now() / (6 * 3600 * 1000));
  return _seededShuffle(pool, seed + 7).slice(0, 15);
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function flattenFolders(tree, depth = 0) {
  let flat = [];
  (tree || []).forEach(f => {
    flat.push({ id: f.id, name: f.name, video_count: f.video_count, parent_id: f.parent_id, depth });
    if (f.children && f.children.length) flat = flat.concat(flattenFolders(f.children, depth + 1));
  });
  return flat;
}

export function uncategorizedCount() {
  return state.videos.filter(v => !v.folder_id).length;
}

export function fmt(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return h + ':' + String(remM).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  return m + ':' + String(s).padStart(2, '0');
}
