<script>
  import { onMount, onDestroy } from "svelte";
  import { appState } from "../lib/state.svelte.js";
  import { updateVideoTitle } from "../lib/api.js";
  import { fmt } from "../lib/utils.js";

  const video = $derived(appState.activeVideo);

  let videoEl = $state(null);
  let isPlaying = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let isMuted = $state(false);
  let isFullscreen = $state(false);
  let showControls = $state(true);
  let controlsTimeout = null;

  let isHolding2x = $state(false);
  let holdTimer = null;
  let wasHolding = false;
  let previousRate = 1.0;

  let isScrubbing = $state(false);
  let wasPlayingBeforeScrub = false;
  let lastTapLeft = 0;
  let lastTapRight = 0;
  let tapTimerLeft = null;
  let tapTimerRight = null;
  let skipFeedback = $state(null);
  let feedbackTimer = null;

  let isEditingTitle = $state(false);
  let editedTitle = $state("");

  function togglePlay() {
    if (!videoEl) return;
    if (wasHolding) {
      wasHolding = false;
      return;
    }
    if (videoEl.paused) {
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
    resetControlsTimeout();
  }

  function handleTimeUpdate() {
    if (!videoEl || isScrubbing) return;
    currentTime = videoEl.currentTime;
    duration = videoEl.duration || 0;
  }

  function handleScrubberPointerDown(e) {
    if (!videoEl) return;
    isScrubbing = true;
    wasPlayingBeforeScrub = !videoEl.paused;
    if (wasPlayingBeforeScrub) videoEl.pause();
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromPointer(e);
  }

  function handleScrubberPointerMove(e) {
    if (!isScrubbing) return;
    seekFromPointer(e);
  }

  function handleScrubberPointerUp(e) {
    if (!isScrubbing) return;
    seekFromPointer(e);
    isScrubbing = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (wasPlayingBeforeScrub && videoEl) {
      videoEl.play().catch(() => {});
    }
  }

  function seekFromPointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * (duration || 0);
    currentTime = targetTime;
    if (videoEl) {
      videoEl.currentTime = targetTime;
    }
  }

  function handleLeftTap(e) {
    e?.stopPropagation?.();
    const now = Date.now();
    if (now - lastTapLeft < 300) {
      clearTimeout(tapTimerLeft);
      skipTime(-5);
      showSkipFeedback("-5s", "left");
      lastTapLeft = 0;
    } else {
      lastTapLeft = now;
      tapTimerLeft = setTimeout(() => {
        togglePlay();
      }, 300);
    }
  }

  function handleRightTap(e) {
    e?.stopPropagation?.();
    const now = Date.now();
    if (now - lastTapRight < 300) {
      clearTimeout(tapTimerRight);
      skipTime(5);
      showSkipFeedback("+5s", "right");
      lastTapRight = 0;
    } else {
      lastTapRight = now;
      tapTimerRight = setTimeout(() => {
        togglePlay();
      }, 300);
    }
  }

  function showSkipFeedback(text, side) {
    clearTimeout(feedbackTimer);
    skipFeedback = { text, side };
    feedbackTimer = setTimeout(() => {
      skipFeedback = null;
    }, 700);
  }

  function toggleMute() {
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    isMuted = videoEl.muted;
  }

  function toggleFullscreen() {
    const wrap = document.getElementById("player-wrapper");
    if (!document.fullscreenElement) {
      wrap?.requestFullscreen?.();
      isFullscreen = true;
    } else {
      document.exitFullscreen?.();
      isFullscreen = false;
    }
  }

  function skipTime(seconds) {
    if (!videoEl) return;
    videoEl.currentTime = Math.max(0, Math.min(videoEl.duration || 0, videoEl.currentTime + seconds));
  }

  function handlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    wasHolding = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (videoEl && !videoEl.paused) {
        previousRate = videoEl.playbackRate;
        videoEl.playbackRate = 2.0;
        isHolding2x = true;
        wasHolding = true;
      }
    }, 250);
  }

  function handlePointerUp() {
    clearTimeout(holdTimer);
    if (isHolding2x && videoEl) {
      videoEl.playbackRate = previousRate || 1.0;
      isHolding2x = false;
    }
  }

  function resetControlsTimeout() {
    showControls = true;
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      if (isPlaying) {
        showControls = false;
      }
    }, 3000);
  }

  function handleKeyDown(e) {
    if (isEditingTitle) return;

    switch (e.key.toLowerCase()) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "arrowleft":
        e.preventDefault();
        skipTime(-5);
        break;
      case "arrowright":
        e.preventDefault();
        skipTime(5);
        break;
      case "j":
        e.preventDefault();
        skipTime(-10);
        break;
      case "l":
        e.preventDefault();
        skipTime(10);
        break;
      case "m":
        e.preventDefault();
        toggleMute();
        break;
      case "f":
        e.preventDefault();
        toggleFullscreen();
        break;
      case "escape":
        if (isFullscreen) toggleFullscreen();
        break;
    }
  }

  function handleGoBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      appState.navigate("/");
    }
  }

  function saveTitle() {
    if (video && editedTitle.trim() && editedTitle !== video.title) {
      updateVideoTitle(video.id, editedTitle.trim());
    }
    isEditingTitle = false;
  }

  $effect(() => {
    if (video) {
      editedTitle = video.title;
      if (typeof document !== "undefined" && video.title) {
        document.title = `${video.title} — VidMe`;
      }
    }
  });

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onDestroy(() => {
    if (typeof document !== "undefined") {
      document.title = "VidMe";
    }
    window.removeEventListener("keydown", handleKeyDown);
    clearTimeout(holdTimer);
    clearTimeout(controlsTimeout);
    clearTimeout(tapTimerLeft);
    clearTimeout(tapTimerRight);
    clearTimeout(feedbackTimer);
  });
</script>

<div class="mx-auto flex w-full max-w-6xl flex-col px-4 py-4 md:px-8">
  <div class="mb-4 flex items-center justify-between">
    <button
      onclick={handleGoBack}
      class="flex items-center gap-2 rounded-lg border border-theme-border bg-theme-surface px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-theme-card"
    >
      <span class="material-symbols text-lg">arrow_back</span>
      <span>Kembali</span>
    </button>
  </div>

  <div
    id="player-wrapper"
    role="region"
    aria-label="Video Player Container"
    class="relative aspect-video w-full overflow-hidden rounded-2xl border border-theme-border bg-black shadow-2xl select-none"
    onmousemove={resetControlsTimeout}
    onmouseleave={() => {
      handlePointerUp();
      if (isPlaying) showControls = false;
    }}
    onpointerdown={handlePointerDown}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
  >
    <video
      bind:this={videoEl}
      src={`/stream/${appState.activeVideoId}`}
      class="h-full w-full object-contain cursor-pointer"
      playsinline
      onplay={() => (isPlaying = true)}
      onpause={() => (isPlaying = false)}
      ontimeupdate={handleTimeUpdate}
      onclick={togglePlay}
    ></video>

    {#if isHolding2x}
      <div class="pointer-events-none absolute left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/80 px-4 py-1.5 text-sm font-bold tracking-wider text-amber-300 shadow-lg backdrop-blur-md animate-pulse">
        <span>2x</span>
        <span class="material-symbols text-base">fast_forward</span>
      </div>
    {/if}

    {#if skipFeedback}
      <div class="pointer-events-none absolute top-1/2 z-30 flex -translate-y-1/2 items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-sm font-bold text-white shadow-lg backdrop-blur-md animate-ping {skipFeedback.side === 'left' ? 'left-12' : 'right-12'}">
        <span>{skipFeedback.text}</span>
      </div>
    {/if}

    <!-- Double-tap seek zones on left & right (z-10) -->
    <div
      role="presentation"
      class="absolute inset-y-0 left-0 w-1/4 z-10 cursor-pointer"
      onclick={handleLeftTap}
    ></div>
    <div
      role="presentation"
      class="absolute inset-y-0 right-0 w-1/4 z-10 cursor-pointer"
      onclick={handleRightTap}
    ></div>

    <div
      class="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-transparent to-black/40 p-4 transition-opacity duration-300 {showControls || !isPlaying ? 'opacity-100 z-20 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
    >
      <div class="flex items-center justify-between">
        <h1 class="text-base font-semibold text-white drop-shadow md:text-lg line-clamp-1">
          {video?.title || "Video Player"}
        </h1>
      </div>

      <!-- Area tengah interaktif: klik untuk toggle play/pause dan tombol play saat pause -->
      <div
        role="button"
        tabindex="0"
        aria-label={isPlaying ? "Jeda video" : "Putar video"}
        class="flex-1 w-full cursor-pointer flex items-center justify-center pointer-events-auto"
        onclick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        onkeydown={(e) => (e.key === " " || e.key === "Enter") && togglePlay()}
      >
        {#if !isPlaying}
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform hover:scale-110 shadow-lg">
            <span class="material-symbols text-4xl">play_arrow</span>
          </div>
        {/if}
      </div>

      <div class="flex flex-col gap-2 pointer-events-auto">
        <div
          role="slider"
          tabindex="0"
          aria-label="Timeline Scrubber"
          aria-valuemin="0"
          aria-valuemax={duration || 100}
          aria-valuenow={currentTime || 0}
          class="group/timeline relative flex h-3 w-full cursor-pointer items-center touch-none"
          onpointerdown={handleScrubberPointerDown}
          onpointermove={handleScrubberPointerMove}
          onpointerup={handleScrubberPointerUp}
          onpointercancel={handleScrubberPointerUp}
          onkeydown={(e) => {
            if (e.key === "ArrowLeft") skipTime(-5);
            if (e.key === "ArrowRight") skipTime(5);
          }}
        >
          <div class="relative h-1 w-full rounded-full bg-white/20 transition-all group-hover/timeline:h-2">
            <div
              class="h-full rounded-full bg-indigo-500"
              style={`width: ${duration ? (currentTime / duration) * 100 : 0}%`}
            ></div>
          </div>
        </div>

        <div class="flex items-center justify-between text-white">
          <div class="flex items-center gap-3">
            <button onclick={togglePlay} class="flex items-center justify-center text-white hover:text-indigo-400" title={isPlaying ? "Pause" : "Play"}>
              <span class="material-symbols text-2xl">
                {isPlaying ? "pause" : "play_arrow"}
              </span>
            </button>

            <button onclick={() => skipTime(-10)} class="flex items-center justify-center text-white/80 hover:text-white" title="Mundur 10s (J)">
              <span class="material-symbols text-xl">replay_10</span>
            </button>

            <button onclick={() => skipTime(10)} class="flex items-center justify-center text-white/80 hover:text-white" title="Maju 10s (L)">
              <span class="material-symbols text-xl">forward_10</span>
            </button>

            <div class="flex items-center gap-1.5">
              <button onclick={toggleMute} class="flex items-center justify-center text-white hover:text-indigo-400" title={isMuted ? "Unmute (M)" : "Mute (M)"}>
                <span class="material-symbols text-xl">
                  {isMuted ? "volume_off" : "volume_up"}
                </span>
              </button>
            </div>

            <span class="text-xs font-medium text-slate-300">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </div>

          <div class="flex items-center gap-3">
            <a
              href={`/download/${appState.activeVideoId}`}
              class="flex items-center justify-center text-white/80 hover:text-white"
              title="Download Video"
            >
              <span class="material-symbols text-xl">download</span>
            </a>

            <button onclick={toggleFullscreen} class="flex items-center justify-center text-white hover:text-indigo-400" title="Fullscreen (F)">
              <span class="material-symbols text-xl">
                {isFullscreen ? "fullscreen_exit" : "fullscreen"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="mt-6 rounded-2xl border border-theme-border bg-theme-surface p-6 shadow-sm">
    {#if isEditingTitle}
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={editedTitle}
          class="flex-1 rounded-lg border border-indigo-500 bg-theme-bg px-3 py-1.5 text-lg font-bold text-white focus:outline-none"
        />
        <button
          onclick={saveTitle}
          class="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Simpan
        </button>
        <button
          onclick={() => (isEditingTitle = false)}
          class="rounded-lg border border-theme-border px-3 py-1.5 text-sm font-semibold text-slate-300 hover:bg-theme-card"
        >
          Batal
        </button>
      </div>
    {:else}
      <div class="flex items-start justify-between gap-4">
        <h1 class="text-2xl font-bold tracking-tight text-white md:text-3xl">
          {video?.title || "Untitled Video"}
        </h1>
        <button
          onclick={() => (isEditingTitle = true)}
          class="flex items-center gap-1 rounded-lg border border-theme-border px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-theme-card"
        >
          <span class="material-symbols text-sm">edit</span>
          <span>Edit Judul</span>
        </button>
      </div>
    {/if}

    <div class="mt-4 flex flex-wrap items-center gap-4 text-sm text-theme-muted">
      <span>Durasi: {fmt(video?.duration)}</span>
      <span>&bull;</span>
      <span>Ukuran: {video?.size_bytes ? (video.size_bytes / 1024 / 1024).toFixed(1) + " MB" : "-"}</span>
      <span>&bull;</span>
      <span>Orientasi: {video?.is_portrait ? "Portrait" : "Landscape"}</span>
    </div>
  </div>
</div>
