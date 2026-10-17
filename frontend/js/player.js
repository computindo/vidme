import { state } from './state.js';
import { fmt } from './utils.js';
import { Router } from './router.js';

export const PlayerView = (() => {
  let pvActive = false;
  let pvId = null;
  let pvMetadata = null;
  let controlsTimer = 0;
  let mouseInside = false;
  let lastTapLeft = 0, lastTapRight = 0;
  let touchHandled = false;
  let lastTouchEnd = 0;
  let _skipAcc = { left: 0, right: 0, timer: null };

  const vid = document.getElementById('video');
  const vidLoader = document.getElementById('vid-loader');
  const wrap = document.getElementById('player-wrap');
  const overlay = document.getElementById('controls-overlay');
  const centerTap = document.getElementById('center-tap');
  const playIcon = document.getElementById('play-icon');
  const playIconSymbol = document.getElementById('play-icon-symbol');

  function showLoader() { vidLoader.style.display = 'flex'; playIcon.style.display = 'none'; }
  function hideLoader() { vidLoader.style.display = 'none'; playIcon.style.display = ''; }
  function showControls() { overlay.classList.remove('hidden-ctrl'); clearTimeout(controlsTimer); }
  function scheduleHide(ms) {
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => { if (!mouseInside) overlay.classList.add('hidden-ctrl'); }, ms);
  }
  function playWithSound() {
    vid.muted = false;
    document.getElementById('volume').value = vid.volume || 1;
    vid.paused ? vid.play().catch(() => {}) : vid.pause();
  }
  function flash(el) {
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 600);
  }
  function skip(sec) {
    const side = sec < 0 ? 'left' : 'right';
    const el = document.getElementById(sec < 0 ? 'flash-left' : 'flash-right');
    clearTimeout(_skipAcc.timer);
    _skipAcc[side] += sec;
    el.textContent = (_skipAcc[side] > 0 ? '+' : '') + _skipAcc[side] + 's';
    flash(el);
    _skipAcc.timer = setTimeout(() => { _skipAcc.left = 0; _skipAcc.right = 0; }, 800);
    vid.currentTime = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + sec));
  }
  function handleTap(side) {
    showControls();
    if (!vid.paused) scheduleHide(3000);
    const now = Date.now();
    if (side === 'left') {
      if (now - lastTapLeft < 300) { skip(-5); flash(document.getElementById('flash-left')); lastTapLeft = 0; }
      else lastTapLeft = now;
    } else {
      if (now - lastTapRight < 300) { skip(5); flash(document.getElementById('flash-right')); lastTapRight = 0; }
      else lastTapRight = now;
    }
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else (wrap.requestFullscreen && wrap.requestFullscreen()) || (wrap.webkitRequestFullscreen && wrap.webkitRequestFullscreen());
  }
  function updatePinBtn() {
    const pinned = !!pvMetadata.is_pinned;
    const btn = document.getElementById('btn-pin');
    btn.classList.toggle('border-indigo-400', pinned);
    btn.classList.toggle('text-indigo-300', pinned);
    btn.innerHTML = '<span class="material-symbols-outlined align-middle">push_pin</span> ' + (pinned ? 'Pinned' : 'Pin');
  }
  async function togglePin() {
    const next = !pvMetadata.is_pinned;
    const r = await fetch('/api/videos/' + encodeURIComponent(pvId) + '/pin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: next })
    });
    if (r.ok) { pvMetadata.is_pinned = next; updatePinBtn(); }
  }
  function enterEdit() {
    const titleEl = document.getElementById('title');
    const titleInput = document.getElementById('videoTitleInput');
    const editBtn = document.getElementById('btn-edit-title');
    titleInput.value = pvMetadata.title;
    titleEl.classList.add('hidden');
    editBtn.classList.add('hidden');
    titleInput.classList.remove('hidden');
    titleInput.focus(); titleInput.select();
  }
  async function commitEdit() {
    const titleEl = document.getElementById('title');
    const titleInput = document.getElementById('videoTitleInput');
    const editBtn = document.getElementById('btn-edit-title');
    const newTitle = titleInput.value.trim();
    titleInput.classList.add('hidden');
    titleEl.classList.remove('hidden');
    editBtn.classList.remove('hidden');
    if (!newTitle || newTitle === pvMetadata.title) { titleEl.textContent = pvMetadata.title; return; }
    const r = await fetch('/api/videos/' + encodeURIComponent(pvId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });
    if (r.ok) { pvMetadata.title = newTitle; titleEl.textContent = newTitle; document.title = newTitle + ' — VidMe'; localStorage.setItem('vidme_refresh', '1'); }
    else titleEl.textContent = pvMetadata.title;
  }
  function setup() {
    const portrait = !!pvMetadata.is_portrait;
    document.title = pvMetadata.title + ' — VidMe';
    document.getElementById('title').textContent = pvMetadata.title;
    document.getElementById('date').textContent = new Date(pvMetadata.created_at).toLocaleString();
    document.getElementById('btn-download').href = '/download/' + encodeURIComponent(pvId);
    updatePinBtn();
    document.getElementById('resolution').innerHTML =
      '<option value="original">Original</option>' +
      (pvMetadata.has_480p ? '<option value="480">' + (portrait ? '480w' : '480p') + '</option>' : '') +
      (pvMetadata.has_360p ? '<option value="360">' + (portrait ? '360w' : '360p') + '</option>' : '');
    document.getElementById('resolution').value = pvMetadata.has_480p ? '480' : 'original';
    if (vid.readyState < 3) showLoader();
    wrap.style.visibility = 'visible';
    vid.poster = '/thumb/' + encodeURIComponent(pvId);
    vid.src = '/stream/' + encodeURIComponent(pvId);
    vid.muted = true;
    vid.load();
  }

  return {
    async enter(videoId, folderId) {
      pvActive = true;
      pvId = videoId;
      try {
        const r = await fetch('/api/videos/' + encodeURIComponent(videoId));
        if (!r.ok) throw new Error('not found');
        pvMetadata = await r.json();
        setup();
      } catch (err) {
        Router.navigate('/');
      }
    },
    async exit() {
      pvActive = false;
      clearTimeout(controlsTimer);
      try { vid.pause(); } catch (e) {}
      vid.removeAttribute('src');
      vid.load();
      if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
      document.title = 'VidMe';
    },
    get active() { return pvActive; }
  };
})();

export function initPlayerEvents() {
  const vid = document.getElementById('video');
  const vidLoader = document.getElementById('vid-loader');
  const wrap = document.getElementById('player-wrap');
  const overlay = document.getElementById('controls-overlay');
  const centerTap = document.getElementById('center-tap');
  const playIcon = document.getElementById('play-icon');
  const playIconSymbol = document.getElementById('play-icon-symbol');
  if (!vid || !wrap || !overlay || !centerTap) return;

  function showLoader() { vidLoader.style.display = 'flex'; playIcon.style.display = 'none'; }
  function hideLoader() { vidLoader.style.display = 'none'; playIcon.style.display = ''; }
  function showControls() { overlay.classList.remove('hidden-ctrl'); }
  function scheduleHide(ms) { setTimeout(() => { overlay.classList.add('hidden-ctrl'); }, ms); }
  function playWithSound() {
    vid.muted = false;
    document.getElementById('volume').value = vid.volume || 1;
    vid.paused ? vid.play().catch(() => {}) : vid.pause();
  }
  function flash(el) {
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 600);
  }
  let _skipAcc = { left: 0, right: 0, timer: null };
  function skip(sec) {
    const side = sec < 0 ? 'left' : 'right';
    const el = document.getElementById(sec < 0 ? 'flash-left' : 'flash-right');
    clearTimeout(_skipAcc.timer);
    _skipAcc[side] += sec;
    el.textContent = (_skipAcc[side] > 0 ? '+' : '') + _skipAcc[side] + 's';
    flash(el);
    _skipAcc.timer = setTimeout(() => { _skipAcc.left = 0; _skipAcc.right = 0; }, 800);
    vid.currentTime = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + sec));
  }
  let lastTapLeft = 0, lastTapRight = 0, touchHandled = false, lastTouchEnd = 0;
  function handleTap(side) {
    showControls();
    if (!vid.paused) scheduleHide(3000);
    const now = Date.now();
    if (side === 'left') {
      if (now - lastTapLeft < 300) { skip(-5); flash(document.getElementById('flash-left')); lastTapLeft = 0; }
      else lastTapLeft = now;
    } else {
      if (now - lastTapRight < 300) { skip(5); flash(document.getElementById('flash-right')); lastTapRight = 0; }
      else lastTapRight = now;
    }
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else (wrap.requestFullscreen && wrap.requestFullscreen()) || (wrap.webkitRequestFullscreen && wrap.webkitRequestFullscreen());
  }

  vid.addEventListener('waiting', showLoader);
  vid.addEventListener('seeking', showLoader);
  vid.addEventListener('canplay', hideLoader);
  vid.addEventListener('playing', hideLoader);
  vid.addEventListener('ended', hideLoader);
  vid.addEventListener('play', () => {
    playIcon.style.opacity = '0';
    document.getElementById('btn-play').innerHTML = '<span class="material-symbols-outlined">pause</span>';
  });
  vid.addEventListener('pause', () => {
    playIcon.style.opacity = '1';
    playIconSymbol.textContent = 'play_arrow';
    document.getElementById('btn-play').innerHTML = '<span class="material-symbols-outlined">play_arrow</span>';
    showControls();
  });
  vid.ontimeupdate = () => {
    if (PlayerView.active && !isNaN(vid.duration)) {
      document.getElementById('seek').value = vid.currentTime;
      document.getElementById('time').textContent = fmt(vid.currentTime) + ' / ' + fmt(vid.duration);
    }
  };
  vid.onloadedmetadata = () => {
    if (!PlayerView.active) return;
    document.getElementById('seek').max = vid.duration;
    document.getElementById('time').textContent = '0:00 / ' + fmt(vid.duration);
  };

  wrap.addEventListener('mouseenter', () => { showControls(); });
  wrap.addEventListener('mouseleave', () => { if (!vid.paused) scheduleHide(200); });
  wrap.addEventListener('mousemove', () => { showControls(); if (!vid.paused) scheduleHide(3000); });
  centerTap.addEventListener('touchend', (e) => {
    e.preventDefault();
    touchHandled = true;
    playWithSound();
    showControls();
    if (!vid.paused) scheduleHide(3000);
  }, { passive: false });
  centerTap.addEventListener('click', () => {
    if (touchHandled) { touchHandled = false; return; }
    playWithSound();
    showControls();
    if (!vid.paused) scheduleHide(3000);
  });
  document.getElementById('btn-back').onclick = () => skip(-5);
  document.getElementById('btn-fwd').onclick = () => skip(5);
  document.getElementById('tap-left').addEventListener('touchend', () => { lastTouchEnd = Date.now(); handleTap('left'); }, { passive: true });
  document.getElementById('tap-right').addEventListener('touchend', () => { lastTouchEnd = Date.now(); handleTap('right'); }, { passive: true });
  document.getElementById('tap-left').addEventListener('dblclick', e => { if (Date.now() - lastTouchEnd < 500) return; skip(-5); flash(document.getElementById('flash-left')); });
  document.getElementById('tap-right').addEventListener('dblclick', e => { if (Date.now() - lastTouchEnd < 500) return; skip(5); flash(document.getElementById('flash-right')); });
  document.getElementById('seek').oninput = e => { vid.currentTime = Number(e.target.value); };
  document.getElementById('btn-play').onclick = playWithSound;
  document.getElementById('volume').oninput = e => {
    vid.volume = Number(e.target.value);
    vid.muted = vid.volume === 0;
  };
  document.getElementById('btn-full').onclick = toggleFullscreen;
  document.getElementById('btn-loop').onclick = () => {
    vid.loop = !vid.loop;
    document.getElementById('btn-loop').classList.toggle('border-indigo-400', vid.loop);
    document.getElementById('btn-loop').classList.toggle('text-indigo-300', vid.loop);
  };
  document.getElementById('btn-goback').onclick = e => {
    e.preventDefault();
    let _ret = null; try { _ret = sessionStorage.getItem('vidme-player-return'); sessionStorage.removeItem('vidme-player-return'); } catch (e) {}
    if (_ret && _ret !== location.pathname + location.search) { Router.navigate(_ret); return; }
    const parts = location.pathname.split('/').filter(Boolean);
    const vi = parts.indexOf('v');
    const parent = vi > 0 ? '/' + parts.slice(0, vi).join('/') + '/' : '/';
    Router.navigate(parent);
  };

  document.addEventListener('keydown', e => {
    if (!PlayerView.active) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ' || e.key.toLowerCase() === 'k') { e.preventDefault(); playWithSound(); }
    if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); skip(5); }
  });
  document.addEventListener('fullscreenchange', () => {
    if (!PlayerView.active) return;
    const icon = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
    document.getElementById('btn-full').innerHTML = '<span class="material-symbols-outlined">' + icon + '</span>';
    if (document.fullscreenElement) {
      if (vid.videoWidth > vid.videoHeight) { try { screen.orientation.lock('landscape'); } catch (e) {} }
      else { try { screen.orientation.lock('portrait'); } catch (e) {} }
    } else {
      try { screen.orientation.unlock(); } catch (e) {}
    }
    showControls();
    if (!vid.paused) scheduleHide(3000);
  });
}
