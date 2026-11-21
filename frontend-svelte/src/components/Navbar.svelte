<script>
  import { appState } from "../lib/state.svelte.js";

  let localSearch = $state(appState.searchQuery);
  let debounceTimer = null;

  function handleSearchInput(e) {
    localSearch = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      appState.searchQuery = localSearch;
    }, 200);
  }

  function clearSearch() {
    localSearch = "";
    appState.searchQuery = "";
  }
</script>

<header class="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-theme-border bg-theme-surface/90 px-4 backdrop-blur-md">
  <div class="flex items-center gap-3">
    <!-- Sidebar Reveal Button: visible when sidebar is closed -->
    {#if !appState.sidebarOpen}
      <button
        id="sidebarRevealBtn"
        onclick={() => appState.toggleSidebar()}
        title="Open sidebar"
        class="hidden lg:flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#10182b] px-2.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
      >
        <span class="material-symbols text-xl">left_panel_open</span>
      </button>
    {/if}

    <a
      href="/"
      class="flex items-center gap-2 text-xl font-bold tracking-tight text-white"
      onclick={(e) => {
        e.preventDefault();
        appState.navigate("/");
      }}
    >
      <svg class="h-8 w-8 shrink-0" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M2.45 4.5L7.55 4.5L16 22.2L24.45 4.5L29.55 4.5L18.55 27.5L13.45 27.5Z" fill="#38bdf8" stroke="#38bdf8" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M13.08 6L13.08 12.93L19.08 9.46Z" fill="#7dd3fc"/>
      </svg>
      <span>Vid<span class="text-sky-400">Me</span></span>
    </a>
  </div>

  <div class="relative mx-4 hidden max-w-md flex-1 md:block">
    <div class="relative flex items-center">
      <span class="material-symbols absolute left-3 text-theme-muted">search</span>
      <input
        type="text"
        placeholder="Cari video..."
        value={localSearch}
        oninput={handleSearchInput}
        class="w-full rounded-full border border-theme-border bg-theme-bg py-2 pl-10 pr-10 text-sm text-slate-100 placeholder-theme-muted focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {#if localSearch}
        <button
          onclick={clearSearch}
          class="absolute right-3 flex h-5 w-5 items-center justify-center rounded-full text-theme-muted hover:bg-slate-800 hover:text-white"
        >
          <span class="material-symbols text-sm">close</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="flex items-center gap-2">
    <!-- Select Mode Toggle Button -->
    <button
      onclick={() => appState.toggleSelectMode()}
      class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer {appState.isSelectMode ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40' : 'bg-[#1a2236] text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60'}"
      title="Mode Pilih Video"
    >
      <span class="material-symbols text-base">checklist</span>
      <span class="hidden sm:inline">Select</span>
    </button>

    <!-- Upload Button: Desktop only (hidden on mobile to prevent duplicate with BottomNav) -->
    <button
      onclick={() => (appState.uploadDrawerOpen = !appState.uploadDrawerOpen)}
      class="hidden lg:flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-indigo-600/20 transition-colors hover:bg-indigo-500 active:scale-95"
    >
      <span class="material-symbols text-lg">upload</span>
      <span>Upload</span>
    </button>
  </div>
</header>

{#if appState.mobileSearchOpen}
  <div class="sticky top-16 z-20 flex w-full items-center border-b border-theme-border bg-theme-surface/95 px-4 py-2.5 backdrop-blur-md md:hidden">
    <div class="relative flex w-full items-center">
      <span class="material-symbols absolute left-3 text-theme-muted">search</span>
      <input
        type="text"
        placeholder="Cari video..."
        value={localSearch}
        oninput={handleSearchInput}
        class="w-full rounded-full border border-theme-border bg-theme-bg py-2 pl-10 pr-10 text-sm text-slate-100 placeholder-theme-muted focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {#if localSearch}
        <button
          onclick={clearSearch}
          class="absolute right-3 flex h-5 w-5 items-center justify-center rounded-full text-theme-muted hover:bg-slate-800 hover:text-white"
        >
          <span class="material-symbols text-sm">close</span>
        </button>
      {/if}
    </div>
  </div>
{/if}
