<script>
  import { appState } from "../lib/state.svelte.js";
  import { pinVideo, deleteVideo } from "../lib/api.js";
  import { fmt } from "../lib/utils.js";

  let { video } = $props();

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

  function handleMouseMove() {
    const isTouch = typeof window !== "undefined" && (window.matchMedia("(hover: none)").matches || window.innerWidth < 1024);
    if (isTouch || showVideoPreview) return;
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
    const isTouch = typeof window !== "undefined" && (window.matchMedia("(hover: none)").matches || window.innerWidth < 1024);
    if (isTouch) {
      if (!showVideoPreview && video.has_microclip === 1) {
        showVideoPreview = true;
        return;
      }
    }
    appState.navigate(`/v/${video.id}`);
  }
</script>

<article
  class="group relative flex flex-col overflow-hidden rounded-xl border border-theme-border bg-theme-surface transition-all duration-200 hover:-translate-y-1 hover:border-slate-700 hover:shadow-xl"
  onmouseenter={handleMouseEnter}
  onmousemove={handleMouseMove}
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

    <!-- Top Action Buttons on Thumbnail -->
    <div
      class="absolute right-2 top-2 z-20 flex items-center gap-1.5 transition-opacity duration-200 {video.is_pinned === 1 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}"
    >
      <button
        onclick={(e) => {
          e.stopPropagation();
          pinVideo(video.id, video.is_pinned !== 1);
        }}
        class="flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition-all shadow-md {video.is_pinned === 1 ? 'bg-indigo-600 text-white' : 'bg-black/60 text-slate-300 hover:text-white hover:bg-black/80'}"
        title={video.is_pinned === 1 ? "Batalkan Pin" : "Sematkan Video"}
      >
        <span class="material-symbols text-sm">push_pin</span>
      </button>

      <button
        onclick={(e) => {
          e.stopPropagation();
          if (confirm(`Hapus video "${video.title}"?`)) {
            deleteVideo(video.id);
          }
        }}
        class="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-slate-300 backdrop-blur-md transition-all hover:bg-red-600 hover:text-white shadow-md opacity-0 group-hover:opacity-100"
        title="Hapus Video"
      >
        <span class="material-symbols text-sm">delete</span>
      </button>
    </div>
  </div>

  <div class="flex flex-1 flex-col justify-between p-3">
    <div class="w-full min-w-0">
      <button
        class="text-left cursor-pointer text-sm font-semibold text-slate-100 line-clamp-2 hover:text-indigo-400 w-full break-words"
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

    {#if video.status !== "ready"}
      <div class="mt-2 flex items-center gap-1 text-[11px] text-amber-400">
        <span class="material-symbols animate-spin text-sm">progress_activity</span>
        <span>Memproses...</span>
      </div>
    {/if}
  </div>
</article>
