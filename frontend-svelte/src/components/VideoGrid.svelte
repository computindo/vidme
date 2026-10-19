<script>
  import { appState } from '../lib/state.svelte.js';
  import HeroCarousel from './HeroCarousel.svelte';
  import VideoCard from './VideoCard.svelte';

  const isHomeLanding = $derived(
    !appState.activeFolderId && !appState.virtualView && !appState.searchQuery && !appState.isPageMode
  );

  const PAGE_SIZE = 20;

  const nonPinnedVideos = $derived(
    appState.filteredVideos.filter((v) => isHomeLanding || v.is_pinned !== 1)
  );

  const totalPages = $derived(Math.max(1, Math.ceil(nonPinnedVideos.length / PAGE_SIZE)));

  const pagedVideos = $derived.by(() => {
    if (isHomeLanding) {
      return nonPinnedVideos.slice(0, 15);
    }
    const start = (appState.page - 1) * PAGE_SIZE;
    return nonPinnedVideos.slice(start, start + PAGE_SIZE);
  });

  function setPage(p) {
    if (p < 1 || p > totalPages) return;
    appState.navigate(`/?page=${p}`);
  }
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
  {#if isHomeLanding}
    {#if appState.pinnedVideos.length > 0}
      <section class="mb-8">
        <h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-white">
          <span class="material-symbols text-indigo-400">push_pin</span>
          <span>Disematkan</span>
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {#each appState.pinnedVideos as video (video.id)}
            <VideoCard {video} />
          {/each}
        </div>
      </section>
    {/if}

    <section class="mb-10">
      <HeroCarousel />
    </section>

    <section class="mb-10">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-lg font-bold text-white">
          <span class="material-symbols text-indigo-400">recommend</span>
          <span>Disarankan</span>
        </h2>
        <button
          onclick={() => setPage(1)}
          class="flex items-center gap-1 text-sm font-semibold text-sky-400 hover:text-sky-300"
        >
          <span>Explore Semua ({appState.videos.length})</span>
          <span class="material-symbols text-base">arrow_forward</span>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each pagedVideos as video (video.id)}
          <VideoCard {video} />
        {/each}
      </div>
    </section>
  {:else}
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-xl font-bold text-white">
        {#if appState.searchQuery}
          Hasil Pencarian "{appState.searchQuery}" ({appState.filteredVideos.length})
        {:else if appState.virtualView}
          Koleksi {appState.virtualView.toUpperCase()} ({appState.filteredVideos.length})
        {:else if appState.activeFolderId}
          Folder Video ({appState.filteredVideos.length})
        {:else}
          Halaman {appState.page} dari {totalPages}
        {/if}
      </h2>
    </div>

    {#if pagedVideos.length === 0}
      <div class="flex flex-col items-center justify-center py-24 text-center">
        <span class="material-symbols text-6xl text-theme-muted">videocam_off</span>
        <p class="mt-4 text-lg font-medium text-slate-300">Tidak ada video yang ditemukan</p>
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each pagedVideos as video (video.id)}
          <VideoCard {video} />
        {/each}
      </div>

      {#if totalPages > 1 && !appState.searchQuery && !appState.virtualView}
        <div class="mt-10 flex items-center justify-center gap-1.5">
          <button
            onclick={() => setPage(appState.page - 1)}
            disabled={appState.page === 1}
            class="flex h-9 w-9 items-center justify-center rounded-lg border border-theme-border text-sm text-slate-300 transition-colors hover:bg-theme-card disabled:opacity-30"
          >
            <span class="material-symbols text-base">chevron_left</span>
          </button>

          {#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
            {#if p === 1 || p === totalPages || (p >= appState.page - 2 && p <= appState.page + 2)}
              <button
                onclick={() => setPage(p)}
                class="flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors {p === appState.page ? 'bg-indigo-600 text-white' : 'border border-theme-border text-slate-300 hover:bg-theme-card'}"
              >
                {p}
              </button>
            {/if}
          {/each}

          <button
            onclick={() => setPage(appState.page + 1)}
            disabled={appState.page === totalPages}
            class="flex h-9 w-9 items-center justify-center rounded-lg border border-theme-border text-sm text-slate-300 transition-colors hover:bg-theme-card disabled:opacity-30"
          >
            <span class="material-symbols text-base">chevron_right</span>
          </button>
        </div>
      {/if}
    {/if}
  {/if}
</div>
