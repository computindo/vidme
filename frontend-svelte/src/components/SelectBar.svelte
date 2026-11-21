<script>
  import { appState } from "../lib/state.svelte.js";
  import {
    bulkDeleteVideos,
    bulkPinVideos,
    bulkSetTags,
    bulkAddToAlbum,
    bulkMoveFolder,
    fetchAlbums,
  } from "../lib/api.js";

  const selectedCount = $derived(appState.selectedIds.length);
  const visibleIds = $derived(appState.filteredVideos.map((v) => v.id));
  const allSelected = $derived(appState.isAllVisibleSelected(visibleIds));

  let actionsOpen = $state(false);
  let showTagInput = $state(false);
  let tagInput = $state("");
  let panelEl;
  let tagInputEl;

  // Muat album saat select mode aktif
  $effect(() => {
    if (appState.isSelectMode) fetchAlbums();
  });

  // Klik di luar panel = tutup
  $effect(() => {
    if (!actionsOpen) return;
    const onDocClick = (e) => {
      if (panelEl && !panelEl.contains(e.target)) closePanel();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  });

  $effect(() => {
    if (showTagInput) tagInputEl?.focus();
  });

  function handleSelectAll() {
    appState.selectAllVisible(visibleIds);
  }

  function closePanel() {
    actionsOpen = false;
    showTagInput = false;
  }

  function togglePanel() {
    actionsOpen = !actionsOpen;
    showTagInput = false;
  }

  async function submitTag() {
    const tags = tagInput.trim();
    if (!tags) return;
    closePanel();
    tagInput = "";
    await bulkSetTags(appState.selectedIds, tags);
  }

  async function handleCreateAlbum() {
    const name = prompt("Nama album baru:");
    if (!name || !name.trim()) return;
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const album = await res.json();
      appState.albums = [...appState.albums, album];
      closePanel();
      await bulkAddToAlbum(appState.selectedIds, album.id);
    } catch (err) {
      appState.addToast(`Gagal membuat album: ${err.message}`, "error");
    }
  }

  function handleAddToAlbum(albumId) {
    closePanel();
    bulkAddToAlbum(appState.selectedIds, albumId);
  }

  function handleMoveFolder(folderId) {
    closePanel();
    bulkMoveFolder(appState.selectedIds, folderId);
  }

  function handleCancel() {
    appState.toggleSelectMode();
  }

  async function handlePin() {
    if (selectedCount === 0) return;
    closePanel();
    await bulkPinVideos(appState.selectedIds, true);
  }

  async function handleUnpin() {
    if (selectedCount === 0) return;
    closePanel();
    await bulkPinVideos(appState.selectedIds, false);
  }

  async function handleDelete() {
    if (selectedCount === 0) return;
    if (confirm(`Hapus ${selectedCount} video terpilih? Tindakan ini tidak dapat dibatalkan.`)) {
      await bulkDeleteVideos(appState.selectedIds);
    }
  }
</script>

{#if appState.isSelectMode}
  <div
    class="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between border-t border-indigo-500/40 bg-[#0f172a]/95 px-4 py-3 backdrop-blur-lg shadow-2xl transition-all sm:px-8"
  >
    <div class="flex items-center gap-3">
      <span class="flex h-8 items-center rounded-lg bg-indigo-600/30 px-3 text-xs font-bold text-indigo-300 border border-indigo-500/40">
        {selectedCount} dipilih
      </span>

      <button
        onclick={handleSelectAll}
        class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 border border-slate-700"
      >
        {allSelected ? "Batal Pilih Semua" : "Pilih Semua"}
      </button>

      <button
        onclick={handleCancel}
        class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
      >
        Batal
      </button>
    </div>

    <div class="relative" bind:this={panelEl}>
      <button
        onclick={togglePanel}
        disabled={selectedCount === 0}
        class="flex items-center gap-1.5 rounded-lg bg-indigo-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition-colors hover:bg-indigo-500 disabled:opacity-40 border border-indigo-500/40"
        title="Aksi massal"
      >
        <span class="material-symbols text-sm">bolt</span>
        <span class="hidden sm:inline">Aksi</span>
        <span class="material-symbols text-sm">{actionsOpen ? "expand_more" : "expand_less"}</span>
      </button>

      {#if actionsOpen}
        <div
          class="absolute bottom-full right-0 mb-2 w-60 overflow-hidden rounded-xl border border-indigo-500/30 bg-[#10182b] shadow-2xl shadow-black/50"
        >
          {#if showTagInput}
            <div class="border-b border-slate-700/60 p-2">
              <input
                bind:this={tagInputEl}
                bind:value={tagInput}
                onkeydown={(e) => {
                  if (e.key === "Enter") submitTag();
                  if (e.key === "Escape") showTagInput = false;
                }}
                placeholder="mis. journey,trip"
                class="w-full rounded-lg border border-indigo-500/40 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
              />
            </div>
          {/if}

          <button onclick={() => (showTagInput = !showTagInput)} class="menu-item">
            <span class="material-symbols text-base">sell</span>
            <span>Set Tag</span>
          </button>

          <div class="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Masukkan Album</div>
          <div class="max-h-32 overflow-y-auto">
            {#each appState.albums as album (album.id)}
              <button onclick={() => handleAddToAlbum(album.id)} class="menu-item">
                <span class="material-symbols text-base">photo_library</span>
                <span class="truncate">{album.name}</span>
              </button>
            {/each}
          </div>
          <button onclick={handleCreateAlbum} class="menu-item menu-accent">
            <span class="material-symbols text-base">add</span>
            <span>Buat album baru</span>
          </button>

          <div class="mt-1 border-t border-slate-700/60 px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Pindah Folder</div>
          <div class="max-h-32 overflow-y-auto">
            <button onclick={() => handleMoveFolder(null)} class="menu-item">
              <span class="material-symbols text-base">folder_off</span>
              <span>Tanpa folder</span>
            </button>
            {#each appState.folders as folder (folder.id)}
              <button onclick={() => handleMoveFolder(folder.id)} class="menu-item">
                <span class="material-symbols text-base">folder</span>
                <span class="truncate">{folder.name}</span>
              </button>
            {/each}
          </div>

          <div class="mt-1 border-t border-slate-700/60">
            <button onclick={handlePin} class="menu-item">
              <span class="material-symbols text-base">push_pin</span>
              <span>Pin</span>
            </button>
            <button onclick={handleUnpin} class="menu-item">
              <span class="material-symbols text-base">keep_off</span>
              <span>Unpin</span>
            </button>
            <button onclick={handleDelete} class="menu-item menu-danger">
              <span class="material-symbols text-base">delete</span>
              <span>Hapus</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: rgb(203 213 225);
    text-align: left;
    transition: background-color 0.15s;
  }
  .menu-item:hover {
    background-color: rgba(99, 102, 241, 0.1);
    color: white;
  }
  .menu-accent {
    color: rgb(165 180 252);
  }
  .menu-danger {
    color: rgb(248 113 113);
  }
  .menu-danger:hover {
    background-color: rgba(220, 38, 38, 0.12);
    color: rgb(252 165 165);
  }
</style>
