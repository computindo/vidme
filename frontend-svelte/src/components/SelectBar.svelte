<script>
  import { appState } from "../lib/state.svelte.js";
  import { bulkDeleteVideos, bulkPinVideos } from "../lib/api.js";

  const selectedCount = $derived(appState.selectedIds.length);

  function handleSelectAll() {
    const allIds = appState.filteredVideos.map((v) => v.id);
    appState.selectAllVisible(allIds);
  }

  function handleCancel() {
    appState.toggleSelectMode();
  }

  async function handleDelete() {
    if (selectedCount === 0) return;
    if (confirm(`Hapus ${selectedCount} video terpilih? Tindakan ini tidak dapat dibatalkan.`)) {
      await bulkDeleteVideos(appState.selectedIds);
    }
  }

  async function handlePin() {
    if (selectedCount === 0) return;
    await bulkPinVideos(appState.selectedIds, true);
  }

  async function handleUnpin() {
    if (selectedCount === 0) return;
    await bulkPinVideos(appState.selectedIds, false);
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
        Pilih Semua
      </button>

      <button
        onclick={handleCancel}
        class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
      >
        Batal
      </button>
    </div>

    <div class="flex items-center gap-2">
      <button
        onclick={handlePin}
        disabled={selectedCount === 0}
        class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-40 border border-slate-700"
        title="Sematkan video terpilih"
      >
        <span class="material-symbols text-sm">push_pin</span>
        <span class="hidden sm:inline">Pin</span>
      </button>

      <button
        onclick={handleDelete}
        disabled={selectedCount === 0}
        class="flex items-center gap-1.5 rounded-lg bg-red-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-red-600/20 transition-colors hover:bg-red-500 disabled:opacity-40"
        title="Hapus video terpilih"
      >
        <span class="material-symbols text-sm">delete</span>
        <span>Hapus ({selectedCount})</span>
      </button>
    </div>
  </div>
{/if}
