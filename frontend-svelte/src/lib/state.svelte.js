class GlobalState {
  videos = $state([]);
  folders = $state([]);
  currentRoute = $state('/');
  activeVideoId = $state(null);
  activeFolderId = $state(null);
  virtualView = $state(null); // 'portrait', 'landscape', 'uncategorized'
  searchQuery = $state('');
  page = $state(1);
  isPageMode = $state(false);
  sidebarOpen = $state(true);
  uploadDrawerOpen = $state(false);
  activeUploads = $state([]);
  toasts = $state([]);
  isLoading = $state(false);

  // Derived: Active video object
  activeVideo = $derived(
    this.activeVideoId ? this.videos.find((v) => v.id === this.activeVideoId) || null : null
  );

  // Derived: Filtered videos based on folder / virtual / search
  filteredVideos = $derived.by(() => {
    let list = this.videos;

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      return list.filter((v) => v.title && v.title.toLowerCase().includes(q));
    }

    if (this.virtualView === 'portrait') {
      return list.filter((v) => v.is_portrait === 1);
    }
    if (this.virtualView === 'landscape') {
      return list.filter((v) => v.is_portrait === 0);
    }
    if (this.virtualView === 'uncategorized') {
      return list.filter((v) => !v.folder_id);
    }

    if (this.activeFolderId) {
      return list.filter((v) => v.folder_id === this.activeFolderId);
    }

    return list;
  });

  // Derived: Pinned videos for home
  pinnedVideos = $derived(
    !this.activeFolderId && !this.virtualView && !this.searchQuery
      ? this.videos.filter((v) => v.is_pinned === 1)
      : []
  );

  // Derived: Recent 10 uploads for Hero Carousel
  recentVideos = $derived(
    !this.activeFolderId && !this.virtualView && !this.searchQuery
      ? [...this.videos]
          .filter((v) => v.status === 'ready')
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
          .slice(0, 10)
      : []
  );

  addToast(message, type = 'info', duration = 3000) {
    const id = Math.random().toString(36).slice(2);
    this.toasts.push({ id, message, type });
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, duration);
  }

  navigate(path) {
    if (!this.activeVideoId && path.includes('/v/')) {
      sessionStorage.setItem('vidme-scroll-pos', String(window.scrollY));
    }
    if (window.location.pathname + window.location.search !== path) {
      window.history.pushState(null, '', path);
    }
    this.parseCurrentUrl();
  }

  parseCurrentUrl() {
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    this.isPageMode = searchParams.has('page');
    const pageParam = parseInt(searchParams.get('page') || '1', 10);
    this.page = pageParam > 0 ? pageParam : 1;

    // Check player URL: /v/:id or /:slug/v/:id or /library/:view/v/:id
    const vMatch = path.match(/(?:\/.*)?\/v\/([^/]+)/);
    if (vMatch) {
      if (!this.activeVideoId) {
        sessionStorage.setItem('vidme-scroll-pos', String(window.scrollY));
      }
      this.activeVideoId = vMatch[1];
      this.currentRoute = 'player';
      return;
    }

    const wasPlayer = this.currentRoute === 'player';
    this.activeVideoId = null;
    this.currentRoute = 'grid';

    if (wasPlayer) {
      const saved = sessionStorage.getItem('vidme-scroll-pos');
      if (saved) {
        requestAnimationFrame(() => {
          window.scrollTo(0, parseInt(saved, 10));
        });
      }
    }

    // Check library URL: /library/:view
    const libMatch = path.match(/^\/library\/(portrait|landscape|uncategorized)/);
    if (libMatch) {
      this.virtualView = libMatch[1];
      this.activeFolderId = null;
      return;
    }
    this.virtualView = null;

    // Check folder by slug
    const folderSlug = path.replace(/^\/|\/$/g, '');
    if (folderSlug && folderSlug !== 'index.html' && folderSlug !== 'player.html') {
      const found = this.folders.find((f) => f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === folderSlug);
      if (found) {
        this.activeFolderId = found.id;
        return;
      }
    }

    this.activeFolderId = null;
  }
}

export const appState = new GlobalState();
