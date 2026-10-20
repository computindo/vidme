<script>
  import { appState } from "../lib/state.svelte.js";

  const isHomeActive = $derived(!appState.virtualView && !appState.activeFolderId && appState.currentRoute !== "player");
</script>

<nav id="bottomNav" class="fixed inset-x-0 bottom-0 z-40 flex justify-around items-center border-t border-slate-800 bg-[#10182b] p-3 lg:hidden select-none">
  <button
    onclick={() => appState.navigate("/")}
    class="flex flex-col items-center gap-1 text-xs {isHomeActive ? "text-indigo-300 font-semibold" : "text-slate-400 hover:text-white"}"
  >
    <span class="material-symbols text-xl">home</span>
    <span>Home</span>
  </button>

  <button
    onclick={() => appState.toggleMobileSearch()}
    class="flex flex-col items-center gap-1 text-xs text-slate-400 hover:text-white"
  >
    <span class="material-symbols text-xl">search</span>
    <span>Search</span>
  </button>

  <button
    onclick={() => (appState.uploadDrawerOpen = !appState.uploadDrawerOpen)}
    class="relative flex flex-col items-center gap-1 text-xs text-slate-400 hover:text-white"
  >
    <span class="material-symbols text-xl">upload</span>
    <span>Upload</span>
    {#if appState.activeUploads.length > 0}
      <span class="absolute -top-1 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
        {appState.activeUploads.length}
      </span>
    {/if}
  </button>

  <button
    onclick={() => appState.toggleSidebar()}
    class="flex flex-col items-center gap-1 text-xs text-slate-400 hover:text-white"
  >
    <span class="material-symbols text-xl">video_library</span>
    <span>Library</span>
  </button>
</nav>
