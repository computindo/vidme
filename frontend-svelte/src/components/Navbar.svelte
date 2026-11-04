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
        class="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#10182b] px-2.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
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
      <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-lg shadow-indigo-500/30">
        <span class="material-symbols text-xl">play_arrow</span>
      </span>
      <span>Vid<span class="text-indigo-400">Me</span></span>
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
    <button
      class="flex h-10 w-10 items-center justify-center rounded-lg text-theme-muted hover:bg-theme-card hover:text-white md:hidden"
      onclick={() => appState.toggleMobileSearch()}
      aria-label="Toggle Search"
    >
      <span class="material-symbols">{appState.mobileSearchOpen ? "close" : "search"}</span>
    </button>
    <button
      onclick={() => (appState.uploadDrawerOpen = !appState.uploadDrawerOpen)}
      class="flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-indigo-600/20 transition-colors hover:bg-indigo-500 active:scale-95"
    >
      <span class="material-symbols text-lg">upload</span>
      <span class="hidden sm:inline">Upload</span>
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
