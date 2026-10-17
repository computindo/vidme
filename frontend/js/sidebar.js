import { $, state } from './state.js';
import { openVideo } from './router.js';

export function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  const isCollapsed = sb.classList.toggle('sidebar-collapsed');
  localStorage.setItem('vidme_sidebar_collapsed', isCollapsed ? '1' : '0');
  const main = document.getElementById('mainContent');
  if (main) main.classList.toggle('sidebar-collapsed-main', isCollapsed);
}

export function restoreSidebar() {
  if (localStorage.getItem('vidme_sidebar_collapsed') === '1') {
    const sb = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    if (sb) sb.classList.add('sidebar-collapsed');
    if (main) main.classList.add('sidebar-collapsed-main');
  }
}

const _clipCache = new Map();
let activeVideo = null;
let activeCard = null;
let openTimer = null;

export function stopPreview() {
  clearTimeout(openTimer);
  if (activeVideo) {
    try {
      activeVideo.pause();
      activeVideo.removeAttribute('src');
      activeVideo.load();
      activeVideo.remove();
    } catch (e) {}
    activeVideo = null;
  }
  activeCard = null;
}

export async function showPreview(card) {
  const clipId = card.dataset.clip;
  if (!clipId) return;
  const frame = card.querySelector('.video-frame');
  if (!frame) return;

  const vid = document.createElement('video');
  vid.className = 'hover-preview-video';
  vid.muted = true;
  vid.loop = true;
  vid.playsInline = true;
  vid.setAttribute('playsinline', '');
  vid.preload = 'none';

  frame.appendChild(vid);
  activeVideo = vid;
  activeCard = card;

  let src = _clipCache.get(clipId);
  if (!src) {
    try {
      const r = await fetch('/clip/' + clipId);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      src = URL.createObjectURL(await r.blob());
      _clipCache.set(clipId, src);
    } catch (e) {
      return;
    }
  }
  if (activeVideo !== vid) return;
  vid.src = src;
  vid.play().catch(() => {});
}

export const isTouchPrimary = () => matchMedia('(hover: none)').matches;

export function initHoverPreview() {
  const container = document.getElementById('videos');
  if (!container) return;

  container.addEventListener('mouseover', e => {
    const card = e.target.closest('.video-card');
    if (card === activeCard) return;
    stopPreview();
    if (!card || state.selectMode || isTouchPrimary()) return;
    openTimer = setTimeout(() => showPreview(card), 250);
  });

  container.addEventListener('mouseleave', () => stopPreview());

  container.addEventListener('click', e => {
    if (!isTouchPrimary() || state.selectMode) return;
    const card = e.target.closest('.video-card');
    if (!card || !card.dataset.clip) return;
    if (activeCard === card) {
      e.preventDefault();
      e.stopPropagation();
      stopPreview();
      openVideo(card.dataset.id, card.dataset.folderId);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    stopPreview();
    showPreview(card);
  }, true);
}

export function initSidebarBehavior() {
  const sidebar = document.getElementById('sidebar');
  const logo = document.getElementById('pvSidebarLogo');
  const playerEl = document.getElementById('view-player');
  if (!sidebar || !logo || !playerEl) return;

  const syncMode = () => {
    const isPlayer = playerEl.style.display !== 'none';
    document.body.classList.toggle('pv-mode', isPlayer);
    if (!isPlayer) sidebar.classList.remove('pv-sidebar-open');
  };
  new MutationObserver(syncMode).observe(playerEl, { attributes: true, attributeFilter: ['style'] });

  logo.addEventListener('mouseenter', () => sidebar.classList.add('pv-sidebar-open'));
  logo.addEventListener('click', () => sidebar.classList.toggle('pv-sidebar-open'));
  sidebar.addEventListener('mouseleave', () => {
    if (document.body.classList.contains('pv-mode')) sidebar.classList.remove('pv-sidebar-open');
  });
}
