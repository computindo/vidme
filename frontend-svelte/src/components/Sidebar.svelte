<script>
  import { appState } from '../lib/state.svelte.js';
  import { slugify } from '../lib/utils.js';

  function countVideosByFolder(folderId) {
    return appState.videos.filter((v) => v.folder_id === folderId).length;
  }

  const portraitCount = $derived(appState.videos.filter((v) => v.is_portrait === 1).length);
  const landscapeCount = $derived(appState.videos.filter((v) => v.is_portrait === 0).length);
  const uncategorizedCount = $derived(appState.videos.filter((v) => !v.folder_id).length);
</script>

<aside
  class="fixed left-0 top-16 z-20 h-[calc(100vh-4rem)] w-64 border-r border-theme-border bg-theme-surface/95 transition-transform duration-300 md:translate-x-0 {appState.sidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
>
  <div class="flex h-full flex-col justify-between overflow-y-auto p-4">
    <div class="space-y-6">
      <div class="space-y-1">
        <button
          onclick={() => appState.navigate('/')}
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors {!appState.virtualView && !appState.activeFolderId ? 'bg-indigo-600/10 text-indigo-400' : 'text-slate-300 hover:bg-theme-card hover:text-white'}"
        >
          <span class="material-symbols text-xl">home</span>
          <span>Semua Video</span>
        </button>
      </div>

      <div>
        <h3 class="px-3 text-xs font-semibold uppercase tracking-wider text-theme-muted">Perpustakaan</h3>
        <div class="mt-2 space-y-1">
          <button
            onclick={() => appState.navigate('/library/portrait')}
            class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors {appState.virtualView === 'portrait' ? 'bg-indigo-600/10 text-indigo-400' : 'text-slate-300 hover:bg-theme-card hover:text-white'}"
          >
            <div class="flex items-center gap-3">
              <span class="material-symbols text-xl">stay_current_portrait</span>
              <span>Portrait</span>
            </div>
            <span class="text-xs text-theme-muted">{portraitCount}</span>
          </button>

          <button
            onclick={() => appState.navigate('/library/landscape')}
            class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors {appState.virtualView === 'landscape' ? 'bg-indigo-600/10 text-indigo-400' : 'text-slate-300 hover:bg-theme-card hover:text-white'}"
          >
            <div class="flex items-center gap-3">
              <span class="material-symbols text-xl">stay_current_landscape</span>
              <span>Landscape</span>
            </div>
            <span class="text-xs text-theme-muted">{landscapeCount}</span>
          </button>

          <button
            onclick={() => appState.navigate('/library/uncategorized')}
            class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors {appState.virtualView === 'uncategorized' ? 'bg-indigo-600/10 text-indigo-400' : 'text-slate-300 hover:bg-theme-card hover:text-white'}"
          >
            <div class="flex items-center gap-3">
              <span class="material-symbols text-xl">folder_open</span>
              <span>Tanpa Kategori</span>
            </div>
            <span class="text-xs text-theme-muted">{uncategorizedCount}</span>
          </button>
        </div>
      </div>

      {#if appState.folders.length > 0}
        <div>
          <h3 class="px-3 text-xs font-semibold uppercase tracking-wider text-theme-muted">Folder</h3>
          <div class="mt-2 space-y-1">
            {#each appState.folders as folder (folder.id)}
              <button
                onclick={() => appState.navigate(`/${slugify(folder.name)}`)}
                class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors {appState.activeFolderId === folder.id ? 'bg-indigo-600/10 text-indigo-400' : 'text-slate-300 hover:bg-theme-card hover:text-white'}"
              >
                <div class="flex items-center gap-3 truncate">
                  <span class="material-symbols text-xl text-amber-400">folder</span>
                  <span class="truncate">{folder.name}</span>
                </div>
                <span class="text-xs text-theme-muted">{countVideosByFolder(folder.id)}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="border-t border-theme-border pt-4 text-xs text-theme-muted">
      VidMe v2.0 &bull; Svelte 5 + Rust
    </div>
  </div>
</aside>
