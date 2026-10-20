<script>
  import { appState } from "../lib/state.svelte.js";
  import { pinVideo, deleteVideo } from "../lib/api.js";
  import { fmt } from "../lib/utils.js";

  let { video } = $props();

  let isHovered = $state(false);
  let hoverTimer = null;
  let showVideoPreview = $state(false);

  function handleMouseEnter() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (video.has_microclip === 1) {
        showVideoPreview = true;
      }
    }, 250);
  }

  function handleMouseLeave() {
    clearTimeout(hoverTimer);
    showVideoPreview = false;
  }

  function handleCardClick() {
    appState.navigate(`/v/${video.id}`);
  }
</script>

<article
  class="group relative flex flex-col overflow-hidden rounded-xl border border-theme-border bg-theme-surface transition-all duration-200 hover:-translate-y-1 hover:border-slate-700 hover:shadow-xl"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <div
    role="button"
    tabindex="0"
    class="relative w-full cursor-pointer overflow-hidden bg-black aspect-[9/16] flex items-center justify-center"
    onclick={handleCardClick}
    onkeydown={(e) => e.key === "Enter" && handleCardClick()}
  >
    {#if showVideoPreview}
      <video
        src={`/clip/${video.id}`}
        autoplay
        loop
        muted
        playsinline
        class="h-full w-full object-contain"
      ></video>
    {:else}
      <img
        src={`/storyboard/${video.id}`}
        alt={video.title}
        class="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
        onerror={(e) => (e.target.src = `/thumb/${video.id}`)}
        loading="lazy"
      />
    {/if}

    {#if video.duration}
      <span class="absolute bottom-2 left-2 z-10 rounded bg-black/80 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
        {fmt(video.duration)}
      </span>
    {/if}

    {#if video.is_pinned === 1}
      <span class="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white shadow">
        <span class="material-symbols text-sm">push_pin</span>
      </span>
    {/if}
  </div>

  <div class="flex flex-1 flex-col justify-between p-3">
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <button
          class="text-left cursor-pointer text-sm font-semibold text-slate-100 line-clamp-2 hover:text-indigo-400"
          onclick={handleCardClick}
        >
          {video.title}
        </button>
        {#if video.created_at}
          <p class="mt-1 text-xs text-slate-500">
            {new Date(video.created_at).toLocaleDateString()}
          </p>
        {/if}
      </div>

      <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onclick={() => pinVideo(video.id, video.is_pinned !== 1)}
          class="flex h-7 w-7 items-center justify-center rounded text-theme-muted hover:bg-theme-card hover:text-white"
          title={video.is_pinned === 1 ? "Batalkan Pin" : "Sematkan Video"}
        >
          <span class="material-symbols text-base">push_pin</span>
        </button>
        <button
          onclick={() => {
            if (confirm(`Hapus video "${video.title}"?`)) {
              deleteVideo(video.id);
            }
          }}
          class="flex h-7 w-7 items-center justify-center rounded text-theme-muted hover:bg-red-500/10 hover:text-red-400"
          title="Hapus Video"
        >
          <span class="material-symbols text-base">delete</span>
        </button>
      </div>
    </div>

    {#if video.status !== "ready"}
      <div class="mt-2 flex items-center gap-1 text-[11px] text-amber-400">
        <span class="material-symbols animate-spin text-sm">progress_activity</span>
        <span>Memproses...</span>
      </div>
    {/if}
  </div>
</article>
