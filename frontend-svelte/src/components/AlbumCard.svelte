<script>
  import { appState } from "../lib/state.svelte.js";
  import { slugify } from "../lib/utils.js";

  let { album } = $props();

  let stage = $state(0); // 0 = /cover-image, 1 = storyboard, 2 = thumb

  const src = $derived(
    stage === 0
      ? `/cover-image/${album.id}?v=${album.cover_image ? encodeURIComponent(album.cover_image) : "0"}`
      : album.cover_video_id
        ? stage === 1
          ? `/storyboard/${album.cover_video_id}`
          : `/thumb/${album.cover_video_id}`
        : null
  );

  function handleError() {
    stage += 1;
  }

  function open() {
    appState.navigate(`/album/${slugify(album.name)}`);
  }
</script>

<button
  type="button"
  onclick={open}
  class="group flex w-full flex-col overflow-hidden rounded-xl border border-theme-border bg-theme-surface text-left transition-all hover:-translate-y-1 hover:shadow-xl hover:border-slate-700"
>
  <div class="relative w-full overflow-hidden bg-black aspect-video">
    {#if src}
      <img
        {src}
        alt={album.name}
        class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        onerror={handleError}
        loading="lazy"
      />
    {:else}
      <div class="flex h-full w-full items-center justify-center bg-theme-bg">
        <span class="material-symbols text-4xl text-slate-600">photo_library</span>
      </div>
    {/if}
    <span class="absolute bottom-2 right-2 z-10 rounded bg-black/80 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
      {album.video_count} video
    </span>
  </div>
  <div class="p-3">
    <p class="truncate text-sm font-semibold text-slate-100">{album.name}</p>
  </div>
</button>
