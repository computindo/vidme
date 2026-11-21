<script>
  import { appState } from "../lib/state.svelte.js";
  import { slugify } from "../lib/utils.js";
  import VideoCard from "./VideoCard.svelte";

  const tagVideos = $derived.by(() => {
    if (!appState.activeTagSlug) return [];
    return appState.videos.filter((v) => {
      if (!v.tags) return false;
      return v.tags.split(",").some((t) => slugify(t.trim()) === appState.activeTagSlug);
    });
  });

  const tagName = $derived.by(() => {
    for (const v of appState.videos) {
      if (!v.tags) continue;
      const hit = v.tags.split(",").find((t) => slugify(t.trim()) === appState.activeTagSlug);
      if (hit) return hit.trim();
    }
    return appState.activeTagSlug || "";
  });
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
  <div class="mb-6">
    <h1 class="text-2xl font-bold tracking-tight text-white md:text-3xl">
      <span class="text-indigo-400">#</span>{tagName}
    </h1>
    <p class="mt-1 text-sm text-slate-400">{tagVideos.length} video</p>
  </div>

  {#if tagVideos.length === 0}
    <div class="flex flex-col items-center justify-center py-24 text-center">
      <span class="material-symbols text-6xl text-slate-600">sell</span>
      <p class="mt-4 text-lg font-medium text-slate-300">Tidak ada video dengan tag ini</p>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {#each tagVideos as video (video.id)}
        <VideoCard {video} />
      {/each}
    </div>
  {/if}
</div>
