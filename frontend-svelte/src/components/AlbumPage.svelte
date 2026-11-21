<script>
  import { appState } from "../lib/state.svelte.js";
  import {
    updateAlbum,
    deleteAlbum,
    uploadAlbumCover,
    setAlbumCoverVideo,
    addVideoToAlbum,
  } from "../lib/api.js";
  import VideoCard from "./VideoCard.svelte";

  const album = $derived(appState.activeAlbum);
  const memberIds = $derived(album ? appState.albumMembers[album.id] || [] : []);
  const memberVideos = $derived(
    memberIds.map((id) => appState.videos.find((v) => v.id === id)).filter(Boolean)
  );

  // Inline edit name / description
  let isEditingName = $state(false);
  let editedName = $state("");
  let isEditingDesc = $state(false);
  let editedDesc = $state("");

  // Modals
  let showAddVideo = $state(false);
  let showCoverPicker = $state(false);
  let coverFileInput;

  $effect(() => {
    if (album) {
      editedName = album.name;
      editedDesc = album.description || "";
      appState.ensureAlbumMembers(album.id);
    }
  });

  const nonMemberVideos = $derived(
    appState.videos.filter((v) => !memberIds.includes(v.id))
  );

  async function saveName() {
    if (album && editedName.trim() && editedName.trim() !== album.name) {
      await updateAlbum(album.id, { name: editedName.trim() });
    }
    isEditingName = false;
  }

  async function saveDesc() {
    if (album && editedDesc !== (album.description || "")) {
      await updateAlbum(album.id, { description: editedDesc });
    }
    isEditingDesc = false;
  }

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !album) return;
    await uploadAlbumCover(album.id, file);
  }

  async function handleDelete() {
    if (!album) return;
    if (confirm(`Hapus album "${album.name}"? Video di dalamnya TIDAK akan terhapus.`)) {
      const ok = await deleteAlbum(album.id);
      if (ok) appState.navigate("/");
    }
  }
</script>

{#if album}
  <div class="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
    <button
      type="button"
      onclick={() => appState.navigate("/")}
      class="mb-4 flex items-center gap-2 rounded-lg border border-theme-border bg-theme-surface px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-theme-card"
    >
      <span class="material-symbols text-lg">arrow_back</span>
      <span>Kembali</span>
    </button>

    <div class="mb-6">
      {#if isEditingName}
        <div class="flex items-center gap-2">
          <input
            type="text"
            bind:value={editedName}
            onkeydown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") (isEditingName = false), (editedName = album.name);
            }}
            onblur={saveName}
            class="flex-1 rounded-lg border border-indigo-500 bg-theme-bg px-3 py-1.5 text-2xl font-bold text-white focus:outline-none"
            autofocus
          />
          <button
            type="button"
            onclick={saveName}
            class="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
          >
            Simpan
          </button>
        </div>
      {:else}
        <div class="group/name flex items-center gap-2">
          <button
            type="button"
            onclick={() => (isEditingName = true)}
            class="text-left text-2xl font-bold tracking-tight text-white md:text-3xl cursor-pointer hover:text-indigo-300 transition-colors"
            title="Klik untuk ubah nama album"
          >
            {album.name}
          </button>
          <button
            type="button"
            onclick={() => (isEditingName = true)}
            class="rounded p-1 text-slate-500 opacity-0 transition-opacity hover:text-indigo-300 group-hover/name:opacity-100 cursor-pointer"
            title="Ubah nama album"
          >
            <span class="material-symbols text-lg">edit</span>
          </button>
        </div>
      {/if}

      {#if isEditingDesc}
        <div class="mt-2 flex items-center gap-2">
          <input
            type="text"
            bind:value={editedDesc}
            placeholder="Deskripsi album"
            onkeydown={(e) => {
              if (e.key === "Enter") saveDesc();
              if (e.key === "Escape") (isEditingDesc = false), (editedDesc = album.description || "");
            }}
            onblur={saveDesc}
            class="flex-1 rounded-lg border border-indigo-500 bg-theme-bg px-3 py-1.5 text-sm text-slate-100 focus:outline-none"
          />
          <button
            type="button"
            onclick={saveDesc}
            class="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
          >
            Simpan
          </button>
        </div>
      {:else}
        <div class="group/desc mt-1 flex items-center gap-2">
          <button
            type="button"
            onclick={() => (isEditingDesc = true)}
            class="text-left text-sm text-slate-400 cursor-pointer hover:text-indigo-300 transition-colors {album.description ? '' : 'italic text-slate-600'}"
            title="Klik untuk ubah deskripsi"
          >
            {album.description || "Tambah deskripsi..."}
          </button>
          <button
            type="button"
            onclick={() => (isEditingDesc = true)}
            class="rounded p-1 text-slate-500 opacity-0 transition-opacity hover:text-indigo-300 group-hover/desc:opacity-100 cursor-pointer"
            title="Ubah deskripsi"
          >
            <span class="material-symbols text-sm">edit</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="mb-6 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onclick={() => showAddVideo = true}
        class="flex items-center gap-1.5 rounded-lg bg-indigo-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-colors hover:bg-indigo-500"
      >
        <span class="material-symbols text-base">add</span>
        <span>Tambah Video</span>
      </button>

      <button
        type="button"
        onclick={() => coverFileInput?.click()}
        class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 border border-slate-700"
      >
        <span class="material-symbols text-base">upload</span>
        <span>Ganti Cover</span>
      </button>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="hidden"
        bind:this={coverFileInput}
        onchange={handleCoverUpload}
      />

      <button
        type="button"
        onclick={() => showCoverPicker = true}
        class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 border border-slate-700"
      >
        <span class="material-symbols text-base">image</span>
        <span>Thumbnail Video</span>
      </button>

      <button
        type="button"
        onclick={handleDelete}
        class="ml-auto flex items-center gap-1.5 rounded-lg bg-red-600/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-600 hover:text-white border border-red-500/30"
      >
        <span class="material-symbols text-base">delete</span>
        <span>Hapus Album</span>
      </button>
    </div>

    {#if memberVideos.length === 0}
      <div class="flex flex-col items-center justify-center py-24 text-center">
        <span class="material-symbols text-6xl text-slate-600">photo_library</span>
        <p class="mt-4 text-lg font-medium text-slate-300">Album masih kosong</p>
        <p class="mt-1 text-sm text-slate-500">Tambahkan video lewat tombol "Tambah Video"</p>
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each memberVideos as video (video.id)}
          <VideoCard {video} />
        {/each}
      </div>
    {/if}

    <!-- Modal: Tambah Video (non-member list) -->
    {#if showAddVideo}
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onclick={() => (showAddVideo = false)}>
        <div class="w-[min(92vw,560px)] max-h-[70vh] overflow-hidden rounded-xl border border-theme-border bg-[#10182b] shadow-2xl flex flex-col" onclick={(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 class="text-sm font-bold text-white">Tambah Video ke "{album.name}"</h3>
            <button type="button" onclick={() => (showAddVideo = false)} class="text-slate-400 hover:text-white cursor-pointer">
              <span class="material-symbols">close</span>
            </button>
          </div>
          <div class="overflow-y-auto p-2">
            {#if nonMemberVideos.length === 0}
              <p class="p-6 text-center text-sm text-slate-500">Semua video sudah ada di album ini</p>
            {:else}
              {#each nonMemberVideos as video (video.id)}
                <button
                  type="button"
                  onclick={() => addVideoToAlbum(video.id, album.id)}
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-800"
                >
                  <img src="/thumb/{video.id}" alt="" class="h-10 w-16 flex-none rounded bg-black object-contain" loading="lazy" />
                  <span class="truncate text-sm text-slate-200">{video.title}</span>
                  <span class="material-symbols ml-auto text-base text-indigo-400">add</span>
                </button>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Modal: pilih thumbnail video member sebagai cover -->
    {#if showCoverPicker}
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onclick={() => (showCoverPicker = false)}>
        <div class="w-[min(92vw,560px)] max-h-[70vh] overflow-hidden rounded-xl border border-theme-border bg-[#10182b] shadow-2xl flex flex-col" onclick={(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 class="text-sm font-bold text-white">Pilih cover dari video member</h3>
            <button type="button" onclick={() => (showCoverPicker = false)} class="text-slate-400 hover:text-white cursor-pointer">
              <span class="material-symbols">close</span>
            </button>
          </div>
          <div class="overflow-y-auto p-2">
            {#if memberVideos.length === 0}
              <p class="p-6 text-center text-sm text-slate-500">Album masih kosong</p>
            {:else}
              {#each memberVideos as video (video.id)}
                <button
                  type="button"
                  onclick={async () => {
                    showCoverPicker = false;
                    await setAlbumCoverVideo(album.id, video.id);
                  }}
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-800"
                >
                  <img src="/thumb/{video.id}" alt="" class="h-10 w-16 flex-none rounded bg-black object-contain {album.cover_video_id === video.id ? 'ring-2 ring-indigo-500' : ''}" loading="lazy" />
                  <span class="truncate text-sm text-slate-200">{video.title}</span>
                  {#if album.cover_video_id === video.id}
                    <span class="material-symbols ml-auto text-base text-indigo-400">check_circle</span>
                  {/if}
                </button>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
{:else}
  <div class="flex h-[calc(100vh-4rem)] flex-col items-center justify-center">
    <span class="material-symbols text-6xl text-slate-600">photo_album</span>
    <p class="mt-4 text-lg font-medium text-slate-300">Album tidak ditemukan</p>
  </div>
{/if}
