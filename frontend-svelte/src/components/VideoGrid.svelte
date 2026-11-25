<script>
  import { appState } from "../lib/state.svelte.js";
  import HeroCarousel from "./HeroCarousel.svelte";
  import VideoCard from "./VideoCard.svelte";
  import AlbumCard from "./AlbumCard.svelte";

  const isHomeLanding = $derived(
    !appState.activeFolderId && !appState.virtualView && !appState.searchQuery && !appState.isPageMode
  );

  const PAGE_SIZE = 20;

  // vidme-album-substitute: peta video -> album (member pertama yang muncul jadi wakil album)
  const albumIdByVideoId = $derived.by(() => {
    const map = new Map();
    for (const [albumId, vids] of Object.entries(appState.albumMembers)) {
      for (const id of vids || []) {
        if (!map.has(id)) map.set(id, albumId);
      }
    }
    return map;
  });

  // vidme-album-substitute: urutan list memakai daftar video LENGKAP (termasuk member album),
  // lalu member diganti card album SEKALI per album; member berikutnya di-skip.
  // Efek: album berisi 2 video -> 1 card album di posisi member pertama.
  // Home tidak memuat album sama sekali; pencarian tetap menampilkan semua video.
  const listItems = $derived.by(() => {
    const q = appState.searchQuery.trim().toLowerCase();
    if (q) {
      return appState.videos
        .filter((v) => v.title && v.title.toLowerCase().includes(q))
        .map((v) => ({ type: "video", video: v }));
    }

    const seenAlbums = new Set();
    const items = [];
    for (const v of appState.videos) {
      if (v.is_pinned === 1) continue;
      if (appState.virtualView === "portrait" && v.is_portrait !== 1) continue;
      if (appState.virtualView === "landscape" && v.is_portrait !== 0) continue;
      if (appState.virtualView === "uncategorized" && v.folder_id) continue;
      if (appState.activeFolderId && v.folder_id !== appState.activeFolderId) continue;

      const albumId = albumIdByVideoId.get(v.id);
      if (albumId) {
        if (seenAlbums.has(albumId)) continue;
        const album = appState.albums.find((a) => a.id === albumId);
        if (album) {
          seenAlbums.add(albumId);
          items.push({ type: "album", album });
          continue;
        }
      }
      items.push({ type: "video", video: v });
    }
    return items;
  });

  const totalPages = $derived(Math.max(1, Math.ceil(listItems.length / PAGE_SIZE)));

  const pagedItems = $derived.by(() => {
    const start = (appState.page - 1) * PAGE_SIZE;
    return listItems.slice(start, start + PAGE_SIZE);
  });

  // vidme-suggest-count: 16 card di HP/tablet 4-kolom, 15 di desktop (lihat .suggested-grid di app.css)
  const suggestedList = $derived(
    appState.suggestions.length > 0
      ? appState.suggestions.slice(0, 16)
      : listItems
          .filter((i) => i.type === "video")
          .slice(0, 16)
          .map((i) => i.video)
  );

  function setPage(p) {
    if (p < 1 || p > totalPages) return;
    const basePath = (typeof window !== "undefined" ? window.location.pathname : "/").replace(/\/$/, "") || "/";
    const target = basePath === "/" ? `/?page=${p}` : `${basePath}?page=${p}`;
    appState.navigate(target);
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
  }
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
  {#if isHomeLanding}
    <!-- vidme-home-header: judul kiri, total video kanan (TANPA logo — spec user 25-11-26) -->
    <div class="mb-8 flex items-center justify-between gap-4">
      <h1 class="flex min-w-0 items-center text-xl font-bold text-white md:text-2xl">
        <span class="truncate">Your Video Collections</span>
      </h1>
      <span class="shrink-0 text-sm font-medium text-theme-muted">
        video <span class="font-bold text-white">{appState.videos.length}</span>
      </span>
    </div>

    {#if appState.pinnedVideos.length > 0}
      <section class="mb-8">
        <h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-white">
          <span class="material-symbols text-indigo-400">push_pin</span>
          <span>Pinned</span>
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
          <span class="material-symbols text-indigo-400">auto_awesome</span>
          <span>Suggested</span>
        </h2>
      </div>
      <div class="suggested-grid grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each suggestedList as video (video.id)}
          <VideoCard {video} />
        {/each}
      </div>

      <!-- Explore More Button (Bridge home -> /?page=1) -->
      <div style="display:flex;justify-content:center;padding:28px 0 8px">
        <button class="explore-btn" type="button" onclick={() => setPage(1)}>
          <svg class="svgIcon" viewBox="0 0 512 512" height="1em" xmlns="http://www.w3.org/2000/svg">
            <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm50.7-186.9L162.4 380.6c-19.4 7.5-38.5-11.6-31-31l55.5-144.3c3.3-8.5 9.9-15.1 18.4-18.4l144.3-55.5c19.4-7.5 38.5 11.6 31 31L325.1 306.7c-3.2 8.5-9.9 15.1-18.4 18.4zM288 256a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"></path>
          </svg>
          <span>Explore</span>
        </button>
      </div>
    </section>
  {:else}
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-xl font-bold text-white">
        {#if appState.searchQuery}
          Hasil Pencarian "{appState.searchQuery}" ({listItems.length})
        {:else if appState.virtualView}
          Koleksi {appState.virtualView.toUpperCase()} ({listItems.length})
        {:else if appState.activeFolder}
          {appState.activeFolder.name} ({listItems.length})
        {:else if appState.activeFolderId}
          Folder Video ({listItems.length})
        {:else}
          Halaman {appState.page} dari {totalPages}
        {/if}
      </h2>
    </div>

    {#if pagedItems.length === 0}
      <div class="flex flex-col items-center justify-center py-24 text-center">
        <span class="material-symbols text-6xl text-theme-muted">videocam_off</span>
        <p class="mt-4 text-lg font-medium text-slate-300">Tidak ada video yang ditemukan</p>
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each pagedItems as item (item.type === "album" ? `album-${item.album.id}` : `video-${item.video.id}`)}
          {#if item.type === "album"}
            <AlbumCard album={item.album} />
          {:else}
            <VideoCard video={item.video} />
          {/if}
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
                class="flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors {p === appState.page ? "bg-indigo-600 text-white" : "border border-theme-border text-slate-300 hover:bg-theme-card"}"
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
