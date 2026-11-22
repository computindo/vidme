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

<!-- vidme-album-shell: shell identik dengan VideoCard (frame aspect-[9/16], letterbox,
     badge kiri-bawah, judul line-clamp-2) supaya album tidak belang di grid -->
<article
  class="group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200 hover:-translate-y-1 hover:shadow-xl border-theme-border bg-theme-surface hover:border-slate-700"
>
  <div
    role="button"
    tabindex="0"
    class="relative w-full cursor-pointer overflow-hidden bg-black aspect-[9/16] flex items-center justify-center"
    onclick={open}
    onkeydown={(e) => e.key === "Enter" && open()}
  >
    {#if src}
      <img
        {src}
        alt={album.name}
        class="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
        onerror={handleError}
        loading="lazy"
      />
    {:else}
      <div class="flex h-full w-full items-center justify-center bg-theme-bg">
        <span class="material-symbols text-4xl text-slate-600">photo_library</span>
      </div>
    {/if}
    <span
      class="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded bg-black/80 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm"
    >
      <span class="material-symbols text-xs">photo_library</span>
      {album.video_count} video
    </span>
  </div>

  <div class="flex flex-1 flex-col justify-between p-3">
    <div class="w-full min-w-0">
      <button
        class="text-left cursor-pointer text-sm font-semibold text-slate-100 line-clamp-2 hover:text-indigo-400 w-full break-words"
        onclick={open}
      >
        {album.name}
      </button>
    </div>
  </div>
</article>
