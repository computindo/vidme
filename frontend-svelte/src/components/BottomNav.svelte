<script>
  import { appState } from '../lib/state.svelte.js';
</script>

<nav class="fixed bottom-0 left-0 z-30 flex h-16 w-full items-center justify-around border-t border-theme-border bg-theme-surface/95 px-2 backdrop-blur-md md:hidden">
  <button
    onclick={() => appState.navigate('/')}
    class="flex flex-col items-center gap-1 text-xs {!appState.virtualView && !appState.activeFolderId ? 'text-indigo-400 font-medium' : 'text-theme-muted hover:text-white'}"
  >
    <span class="material-symbols text-xl">home</span>
    <span>Home</span>
  </button>

  <button
    onclick={() => appState.navigate('/library/portrait')}
    class="flex flex-col items-center gap-1 text-xs {appState.virtualView === 'portrait' ? 'text-indigo-400 font-medium' : 'text-theme-muted hover:text-white'}"
  >
    <span class="material-symbols text-xl">stay_current_portrait</span>
    <span>Portrait</span>
  </button>

  <button
    onclick={() => (appState.uploadDrawerOpen = !appState.uploadDrawerOpen)}
    class="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
    aria-label="Upload"
  >
    <span class="material-symbols text-2xl">add</span>
  </button>

  <button
    onclick={() => appState.navigate('/library/landscape')}
    class="flex flex-col items-center gap-1 text-xs {appState.virtualView === 'landscape' ? 'text-indigo-400 font-medium' : 'text-theme-muted hover:text-white'}"
  >
    <span class="material-symbols text-xl">stay_current_landscape</span>
    <span>Landscape</span>
  </button>

  <button
    onclick={() => (appState.sidebarOpen = !appState.sidebarOpen)}
    class="flex flex-col items-center gap-1 text-xs text-theme-muted hover:text-white"
  >
    <span class="material-symbols text-xl">folder</span>
    <span>Folder</span>
  </button>
</nav>
