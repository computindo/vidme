<script>
  import { appState } from "../lib/state.svelte.js";
  import { slugify } from "../lib/utils.js";

  function countVideosByFolder(folderId) {
    return appState.videos.filter((v) => v.folder_id === folderId).length;
  }

  const portraitCount = $derived(appState.videos.filter((v) => v.is_portrait === 1).length);
  const landscapeCount = $derived(appState.videos.filter((v) => v.is_portrait === 0).length);
  const uncategorizedCount = $derived(appState.videos.filter((v) => !v.folder_id).length);
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
      <span class="material-symbols text-2xl text-indigo-400">play_circle</span>
      <span>VidMe</span>
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
  </nav>
</aside>
