import { $, state } from './state.js';
import { slugify, _pageParam } from './utils.js';
import { render, renderFolders } from './render.js';
import { PlayerView } from './player.js';

export function openVideo(videoId, folderId) {
  try { sessionStorage.setItem('vidme-player-return', location.pathname + location.search); } catch (e) {}
  let ctx = folderId || '';
  if (state.folder === '__portrait__' || state.folder === '__landscape__' || state.folder === 'null') ctx = state.folder;
  if (ctx === '__portrait__') return Router.navigate('/library/portrait/v/' + encodeURIComponent(videoId));
  if (ctx === '__landscape__') return Router.navigate('/library/landscape/v/' + encodeURIComponent(videoId));
  if (ctx === 'null') return Router.navigate('/library/uncategorized/v/' + encodeURIComponent(videoId));
  const f = ctx ? state.folders.find(x => x.id === ctx) : null;
  const s = f ? slugify(f.name) : '';
  Router.navigate(s ? '/' + s + '/v/' + encodeURIComponent(videoId) : '/v/' + encodeURIComponent(videoId));
}

export function parseUrlFolder() {
  const parts = location.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 2 && parts[0] === 'library') {
    const vmap = { portrait: '__portrait__', landscape: '__landscape__', uncategorized: 'null' };
    return vmap[parts[1]] || null;
  }
  const folder = state.folders.find(f => slugify(f.name) === parts[0]);
  return folder ? folder.id : null;
}

export const Router = {
  parseRoute() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length === 2 && parts[0] === 'v') {
      return { view: 'player', videoId: parts[1], folderId: null };
    }
    if (parts.length === 2 && parts[0] === 'library') {
      const vmap = { portrait: '__portrait__', landscape: '__landscape__', uncategorized: 'null' };
      if (vmap[parts[1]]) return { view: 'browse', folderId: vmap[parts[1]] };
    }
    if (parts.length === 4 && parts[0] === 'library' && parts[2] === 'v') {
      const vmap = { portrait: '__portrait__', landscape: '__landscape__', uncategorized: 'null' };
      return { view: 'player', videoId: parts[3], folderId: vmap[parts[1]] || null };
    }
    if (parts.length === 3 && parts[1] === 'v') {
      const folder = state.folders.find(f => slugify(f.name) === parts[0]);
      return { view: 'player', videoId: parts[2], folderId: folder ? folder.id : null };
    }
    return { view: 'browse', folderId: parseUrlFolder(), page: _pageParam() };
  },

  navigate(url) {
    if (location.pathname + location.search === url) return;
    history.pushState({}, '', url);
    this.renderRoute();
  },

  async renderRoute() {
    const route = this.parseRoute();
    const browseEl = document.getElementById('view-browse');
    const playerEl = document.getElementById('view-player');
    if (!browseEl || !playerEl) return;

    if (route.view === 'player') {
      try { sessionStorage.setItem('vidme-scroll-return', JSON.stringify({ key: this._lastBrowseKey || 'home', y: window.scrollY })); } catch (e) {}
      browseEl.style.display = 'none';
      playerEl.style.display = '';
      this.currentView = 'player';
      await PlayerView.enter(route.videoId, route.folderId);
    } else {
      if (this.currentView === 'player') await PlayerView.exit();
      playerEl.style.display = 'none';
      browseEl.style.display = '';
      this.currentView = 'browse';
      state.page = route.page || 1;
      const urlFolder = route.folderId;
      if (urlFolder) {
        state.folder = urlFolder;
        if (urlFolder === '__portrait__') $('#heading').textContent = 'Portrait';
        else if (urlFolder === '__landscape__') $('#heading').textContent = 'Landscape';
        else if (urlFolder === 'null') $('#heading').textContent = 'Uncategorized';
        else {
          const folder = state.folders.find(f => f.id === urlFolder);
          $('#heading').textContent = folder ? folder.name : 'All videos';
        }
      } else {
        state.folder = null;
        $('#heading').textContent = 'All videos';
      }
      renderFolders();
      render();
    }

    this._lastBrowseKey = route.folderId || 'home';
    if (route.view === 'player') {
      requestAnimationFrame(() => window.scrollTo(0, 0));
    } else {
      let _entry = null;
      try { _entry = JSON.parse(sessionStorage.getItem('vidme-scroll-return') || 'null'); } catch (e) {}
      if (_entry && typeof _entry.y === 'number' && _entry.y > 0) {
        sessionStorage.removeItem('vidme-scroll-return');
        requestAnimationFrame(() => window.scrollTo(0, _entry.y));
      }
    }
  },
  currentView: null,
  _lastBrowseKey: 'home'
};
