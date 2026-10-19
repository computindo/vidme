<script>
  import { onMount, onDestroy } from 'svelte';
  import { appState } from './lib/state.svelte.js';
  import { fetchVideos, fetchFolders, initSSE } from './lib/api.js';

  import Navbar from './components/Navbar.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import VideoGrid from './components/VideoGrid.svelte';
  import Player from './components/Player.svelte';
  import UploadDrawer from './components/UploadDrawer.svelte';
  import Toast from './components/Toast.svelte';

  let sseSource = null;

  function handlePopState() {
    appState.parseCurrentUrl();
  }

  onMount(async () => {
    appState.parseCurrentUrl();
    window.addEventListener('popstate', handlePopState);
    await Promise.all([fetchVideos(), fetchFolders()]);
    sseSource = initSSE();
  });

  onDestroy(() => {
    window.removeEventListener('popstate', handlePopState);
    if (sseSource) sseSource.close();
  });
</script>

<div class="min-h-screen bg-theme-bg text-slate-100 flex flex-col">
  <Navbar />

  <div class="flex flex-1">
    <Sidebar />

    <main
      class="flex-1 transition-all duration-300 pb-20 md:pb-8 {appState.sidebarOpen ? 'md:ml-64' : 'ml-0'}"
    >
      {#if appState.isLoading && appState.videos.length === 0}
        <div class="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div class="flex flex-col items-center gap-3">
            <span class="material-symbols animate-spin text-4xl text-indigo-500">progress_activity</span>
            <p class="text-sm font-medium text-theme-muted">Memuat koleksi video...</p>
          </div>
        </div>
      {:else if appState.currentRoute === 'player'}
        <Player />
      {:else}
        <VideoGrid />
      {/if}
    </main>
  </div>

  <BottomNav />
  <UploadDrawer />
  <Toast />
</div>
