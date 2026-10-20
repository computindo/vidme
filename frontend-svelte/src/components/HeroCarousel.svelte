<script>
  import { appState } from "../lib/state.svelte.js";

  let currentIndex = $state(0);
  const slides = $derived(appState.recentVideos);
  let previewVideoId = $state(null);
  let hoverTimeout = null;

  function nextSlide() {
    if (slides.length === 0) return;
    clearTimeout(hoverTimeout);
    previewVideoId = null;
    currentIndex = (currentIndex + 1) % slides.length;
  }

  function prevSlide() {
    if (slides.length === 0) return;
    clearTimeout(hoverTimeout);
    previewVideoId = null;
    currentIndex = (currentIndex - 1 + slides.length) % slides.length;
  }

  function goToSlide(idx) {
    clearTimeout(hoverTimeout);
    previewVideoId = null;
    currentIndex = idx;
  }

  function handleMouseEnter() {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      if (slides[currentIndex]) {
        previewVideoId = slides[currentIndex].id;
      }
    }, 250);
  }

  function handleMouseMove() {
    const isTouch = typeof window !== "undefined" && (window.matchMedia("(hover: none)").matches || window.innerWidth < 1024);
    if (isTouch) return;
    if (previewVideoId === slides[currentIndex]?.id) return;
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      if (slides[currentIndex]) {
        previewVideoId = slides[currentIndex].id;
      }
    }, 250);
  }

  function handleMouseLeave() {
    clearTimeout(hoverTimeout);
    previewVideoId = null;
  }

  function handleSlideClick(slide) {
    const isTouch = typeof window !== "undefined" && (window.matchMedia("(hover: none)").matches || window.innerWidth < 1024);
    if (isTouch) {
      if (previewVideoId !== slide.id) {
        previewVideoId = slide.id;
        return;
      }
    }
    appState.navigate(`/v/${slide.id}`);
  }

  let touchStartX = 0;
  let touchStartY = 0;

  function handleTouchStart(e) {
    if (e.touches && e.touches.length > 0) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }

  function handleTouchEnd(e) {
    if (e.changedTouches && e.changedTouches.length > 0) {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) {
          nextSlide();
        } else {
          prevSlide();
        }
      }
    }
  }
</script>

{#if slides.length > 0}
  <div
    role="region"
    aria-label="Recent uploads carousel"
    class="relative mx-auto my-6 w-full max-w-5xl px-4"
    ontouchstart={handleTouchStart}
    ontouchend={handleTouchEnd}
  >
    <div
      class="relative overflow-hidden rounded-2xl border border-theme-border bg-theme-surface shadow-2xl"
      onmouseenter={handleMouseEnter}
      onmousemove={handleMouseMove}
      onmouseleave={handleMouseLeave}
    >
      <div class="relative aspect-video w-full overflow-hidden bg-black">
        {#each slides as slide, idx (slide.id)}
          <div
            class="absolute inset-0 transition-opacity duration-500 ease-in-out {idx === currentIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}"
          >
            {#if previewVideoId === slide.id}
              <video
                src={`/clip/${slide.id}`}
                autoplay
                loop
                muted
                playsinline
                class="absolute inset-0 h-full w-full object-contain bg-black z-0"
              ></video>
            {:else}
              <img
                src={`/storyboard/${slide.id}`}
                alt={slide.title}
                class="h-full w-full object-contain"
                onerror={(e) => (e.target.src = `/thumb/${slide.id}`)}
              />
            {/if}

            <div
              role="button"
              tabindex="0"
              class="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/30 to-transparent p-6 text-white cursor-pointer z-10"
              onclick={() => handleSlideClick(slide)}
              onkeydown={(e) => e.key === "Enter" && handleSlideClick(slide)}
            >
              <div class="flex items-center gap-2">
                <span class="inline-flex items-center gap-1.5 self-start rounded-full bg-indigo-600/90 px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur-md">
                  <span class="material-symbols text-sm">auto_awesome</span>
                  Terbaru
                </span>
                {#if previewVideoId === slide.id}
                  <span class="inline-flex items-center gap-1 self-start rounded-full bg-emerald-500/90 px-2.5 py-1 text-xs font-semibold tracking-wider text-white backdrop-blur-md animate-pulse">
                    <span class="material-symbols text-xs">play_arrow</span>
                    Preview
                  </span>
                {/if}
              </div>
              <h2 class="mt-2 text-xl font-bold tracking-tight text-white line-clamp-2 md:text-3xl">
                {slide.title}
              </h2>
              <p class="mt-1 text-xs text-slate-300 md:text-sm">
                Diproses &bull; {slide.is_portrait ? "Portrait" : "Landscape"}
              </p>
            </div>
          </div>
        {/each}

        <div class="absolute right-4 top-4 z-20 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
          {currentIndex + 1} / {slides.length}
        </div>

        <button
          onclick={prevSlide}
          class="absolute left-4 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110 active:scale-95"
          aria-label="Previous Slide"
        >
          <span class="material-symbols">chevron_left</span>
        </button>

        <button
          onclick={nextSlide}
          class="absolute right-4 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110 active:scale-95"
          aria-label="Next Slide"
        >
          <span class="material-symbols">chevron_right</span>
        </button>

        <div class="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5">
          {#each slides as _, idx}
            <button
              onclick={() => goToSlide(idx)}
              class="h-2 rounded-full transition-all {idx === currentIndex ? 'w-6 bg-indigo-500' : 'w-2 bg-white/40 hover:bg-white/70'}"
              aria-label={`Go to slide ${idx + 1}`}
            ></button>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
