<script>
  import { appState } from "../lib/state.svelte.js";
  import { slugify } from "../lib/utils.js";

  function countVideosByFolder(folderId) {
    return appState.videos.filter((v) => v.folder_id === folderId).length;
  }

  const portraitCount = $derived(appState.videos.filter((v) => v.is_portrait === 1).length);
  const landscapeCount = $derived(appState.videos.filter((v) => v.is_portrait === 0).length);
  const uncategorizedCount = $derived(appState.videos.filter((v) => !v.folder_id).length);

  // Unique tags dari field tags video (comma-separated)
  const tagList = $derived.by(() => {
    const counts = new Map();
    for (const v of appState.videos) {
      if (!v.tags) continue;
      for (const raw of v.tags.split(",")) {
        const t = raw.trim();
        if (!t) continue;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count, slug: slugify(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  let tagsOpen = $state(false);
</script>

{#if appState.sidebarOpen}
  <div
    role="presentation"
    onclick={() => appState.toggleSidebar()}
    class="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden cursor-pointer"
  ></div>
{/if}

<aside
  id="sidebar"
  class="fixed inset-y-0 left-0 z-40 flex h-screen w-[280px] flex-col overflow-hidden border-r border-slate-800 bg-[#10182b] p-6 transition-transform duration-300 ease-in-out {appState.sidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
>
  <div class="mb-8 flex items-center justify-between">
    <a
      href="/"
      onclick={(e) => {
        e.preventDefault();
        appState.navigate("/");
      }}
      class="flex items-center gap-3 text-2xl font-bold tracking-tight text-white font-heading"
    >
      <svg class="h-7 w-7 shrink-0" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M2.45 4.5L7.55 4.5L16 22.2L24.45 4.5L29.55 4.5L18.55 27.5L13.45 27.5Z" fill="#38bdf8" stroke="#38bdf8" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M13.08 6L13.08 12.93L19.08 9.46Z" fill="#7dd3fc"/>
      </svg>
      <span>Vid<span class="text-sky-400">Me</span></span>
    </a>
    <button
      id="sidebarToggleBtn"
      onclick={() => appState.toggleSidebar()}
      title="Collapse sidebar"
      class="flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-slate-500 hover:text-white transition-colors cursor-pointer"
    >
      <span class="material-symbols text-xl">left_panel_close</span>
    </button>
  </div>

  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-xs font-semibold uppercase tracking-widest text-slate-500">Folders</h2>
  </div>

  <nav id="folders" class="flex-1 min-h-0 space-y-1 overflow-y-auto scrollbar pr-1">
    <button
      onclick={() => appState.navigate("/")}
      class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors {!appState.virtualView && !appState.activeFolderId ? "text-indigo-300 bg-slate-800" : "text-slate-400 hover:bg-slate-800"}"
    >
      <span class="material-symbols text-xl">video_library</span>
      <span>All videos</span>
    </button>

    <button
      onclick={() => appState.navigate("/library/uncategorized")}
      class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors {appState.virtualView === 'uncategorized' ? 'text-indigo-300 bg-slate-800' : 'text-slate-400 hover:bg-slate-800'}"
    >
      <div class="flex items-center gap-3">
        <span class="material-symbols text-xl">folder_off</span>
        <span>Uncategorized</span>
      </div>
      <span class="text-xs text-slate-500">{uncategorizedCount}</span>
    </button>

    <button
      onclick={() => appState.navigate("/library/portrait")}
      class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors {appState.virtualView === 'portrait' ? 'text-indigo-300 bg-slate-800' : 'text-slate-400 hover:bg-slate-800'}"
    >
      <div class="flex items-center gap-3">
        <span class="material-symbols text-xl">stay_current_portrait</span>
        <span>Portrait</span>
      </div>
      <span class="text-xs text-slate-500">{portraitCount}</span>
    </button>

    <button
      onclick={() => appState.navigate("/library/landscape")}
      class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors {appState.virtualView === 'landscape' ? 'text-indigo-300 bg-slate-800' : 'text-slate-400 hover:bg-slate-800'}"
    >
      <div class="flex items-center gap-3">
        <span class="material-symbols text-xl">stay_current_landscape</span>
        <span>Landscape</span>
      </div>
      <span class="text-xs text-slate-500">{landscapeCount}</span>
    </button>

    {#if appState.folders.length > 0}
      {#each appState.folders as folder (folder.id)}
        <div class="flex items-center rounded-lg hover:bg-slate-800">
          <button
            onclick={() => appState.navigate(`/${slugify(folder.name)}`)}
            class="flex flex-1 items-center gap-3 py-2 px-3 text-left text-sm font-medium transition-colors truncate {appState.activeFolderId === folder.id ? "text-indigo-300" : "text-slate-400"}"
          >
            <span class="material-symbols text-xl text-slate-400">folder</span>
            <span class="truncate">{folder.name}</span>
            <span class="ml-auto text-xs text-slate-500">{countVideosByFolder(folder.id)}</span>
          </button>
        </div>
      {/each}
    {/if}

    <h2 class="mt-6 mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Albums</h2>
    {#if appState.albums.length > 0}
      {#each appState.albums as album (album.id)}
        <button
          onclick={() => appState.navigate(`/album/${slugify(album.name)}`)}
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors truncate {appState.currentRoute === 'album' && appState.activeAlbumId === album.id ? 'text-indigo-300 bg-slate-800' : 'text-slate-400 hover:bg-slate-800'}"
        >
          <span class="material-symbols text-xl text-slate-400">photo_library</span>
          <span class="truncate">{album.name}</span>
          <span class="ml-auto text-xs text-slate-500">{album.video_count}</span>
        </button>
      {/each}
    {:else}
      <p class="px-3 py-1 text-xs text-slate-600">Belum ada album</p>
    {/if}

    <h2 class="mt-6 mb-2">
      <button
        onclick={() => (tagsOpen = !tagsOpen)}
        class="flex w-full items-center justify-between rounded-lg px-3 py-1 text-left text-xs font-semibold uppercase tracking-widest text-slate-500 transition-colors hover:text-slate-300 cursor-pointer"
        title="Tampilkan/sembunyikan tag"
      >
        <span>#Tags</span>
        <span class="material-symbols text-base">{tagsOpen ? "expand_less" : "expand_more"}</span>
      </button>
    </h2>
    {#if tagsOpen && tagList.length > 0}
      <div class="grid grid-cols-2 gap-2 px-1 pb-2">
        {#each tagList as tag (tag.slug)}
          <button
            onclick={() => appState.navigate(`/tag/${tag.slug}`)}
            class="rounded-lg border border-theme-border bg-theme-card px-2.5 py-2 text-left transition-colors hover:border-indigo-500/60 hover:bg-slate-800 {appState.currentRoute === 'tag' && appState.activeTagSlug === tag.slug ? 'border-indigo-500/60 bg-slate-800' : ''}"
          >
            <p class="truncate text-xs font-medium text-slate-200">#{tag.name}</p>
            <p class="text-[10px] text-slate-500">{tag.count} video</p>
          </button>
        {/each}
      </div>
    {/if}
  </nav>
</aside>
