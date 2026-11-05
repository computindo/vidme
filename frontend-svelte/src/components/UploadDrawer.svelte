<script>
  import { onDestroy } from 'svelte';
  import { appState } from '../lib/state.svelte.js';
  import { uploadTusFile } from '../lib/tus.js';
  import { formatBytes, fmtEta } from '../lib/utils.js';
  import { fetchVideos } from '../lib/api.js';

  let fileInput = $state(null);
  let isDragging = $state(false);
  let isUploading = $state(false);
  let uploadQueue = $state([]);
  let interpolationTimer = null;

  const stagedCount = $derived(uploadQueue.filter((q) => q.status === 'staged').length);

  function handleFileSelect(files) {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      const cleanName = f.name.replace(/\.[^.]+$/, '');
      uploadQueue.push({
        id: Math.random().toString(36).slice(2),
        file: f,
        name: f.name,
        title: cleanName,
        folderId: appState.activeFolderId || '',
        size: f.size,
        progress: 0,
        bytesSent: 0,
        bytesTotal: f.size,
        displaySent: 0,
        displayProgress: 0,
        speed: 0,
        eta: 0,
        displayEta: 0,
        anchorSent: 0,
        anchorAt: Date.now(),
        status: 'staged',
        error: null,
        controller: new AbortController(),
      });
    }
    if (fileInput) fileInput.value = '';
  }

  function cancelUpload(item) {
    if (item.status === 'uploading') {
      item.controller.abort();
    }
    item.status = 'cancelled';
    uploadQueue = uploadQueue.filter((q) => q.id !== item.id);
    if (!uploadQueue.some((q) => q.status === 'uploading' || q.status === 'queued')) {
      stopInterpolationTimer();
    }
  }

  function startUploadAll() {
    let hasStaged = false;
    for (const item of uploadQueue) {
      if (item.status === 'staged') {
        item.status = 'queued';
        hasStaged = true;
      }
    }
    if (hasStaged) {
      startInterpolationTimer();
      processQueue();
    }
  }

  function startInterpolationTimer() {
    if (interpolationTimer) return;
    interpolationTimer = setInterval(() => {
      const active = uploadQueue.find((u) => u.status === 'uploading');
      if (!active) {
        if (!isUploading) stopInterpolationTimer();
        return;
      }
      if (active.speed > 0 && active.bytesTotal > 0) {
        const dt = (Date.now() - active.anchorAt) / 1000;
        const interpolated = Math.min(active.bytesTotal, active.anchorSent + active.speed * dt);
        active.displaySent = interpolated;
        active.displayProgress = Math.round((interpolated / active.bytesTotal) * 100);
        active.displayEta = Math.max(0, Math.round((active.bytesTotal - interpolated) / active.speed));
      }
    }, 1000);
  }

  function stopInterpolationTimer() {
    if (interpolationTimer) {
      clearInterval(interpolationTimer);
      interpolationTimer = null;
    }
  }

  onDestroy(() => {
    stopInterpolationTimer();
  });

  async function processQueue() {
    if (isUploading) return;
    const nextItem = uploadQueue.find((item) => item.status === 'queued');
    if (!nextItem) {
      stopInterpolationTimer();
      return;
    }

    isUploading = true;
    nextItem.status = 'uploading';
    nextItem.anchorAt = Date.now();
    nextItem.anchorSent = 0;
    startInterpolationTimer();

    try {
      await uploadTusFile(
        nextItem.file,
        nextItem.folderId || null,
        (prog) => {
          nextItem.bytesSent = prog.offset;
          nextItem.bytesTotal = prog.total;
          nextItem.progress = prog.progress;
          nextItem.speed = prog.speed;
          nextItem.eta = prog.eta;
          nextItem.anchorSent = prog.offset;
          nextItem.anchorAt = Date.now();
          nextItem.displaySent = prog.offset;
          nextItem.displayProgress = prog.progress;
          nextItem.displayEta = prog.eta;

          let entry = appState.activeUploads.find((u) => u.id === nextItem.id);
          if (!entry) {
            entry = {
              id: nextItem.id,
              title: nextItem.title || nextItem.name,
              progress: prog.progress,
              speed: prog.speed,
              eta: prog.eta,
            };
            appState.activeUploads = [...appState.activeUploads, entry];
          } else {
            entry.title = nextItem.title || nextItem.name;
            entry.progress = prog.progress;
            entry.speed = prog.speed;
            entry.eta = prog.eta;
          }
        },
        nextItem.controller.signal,
        nextItem.title
      );
      nextItem.status = 'done';
      nextItem.displayProgress = 100;
      appState.addToast(`Upload selesai: ${nextItem.title || nextItem.name}`, 'success');
      fetchVideos();
    } catch (err) {
      if (nextItem.controller.signal.aborted) {
        nextItem.status = 'cancelled';
      } else {
        nextItem.status = 'error';
        nextItem.error = err.message;
        appState.addToast(`Gagal: ${err.message}`, 'error');
      }
    } finally {
      appState.activeUploads = appState.activeUploads.filter((u) => u.id !== nextItem.id);
      isUploading = false;
      processQueue();
    }
  }
</script>

{#if appState.uploadDrawerOpen}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
    <div
      class="w-full max-w-xl rounded-t-2xl border border-theme-border bg-theme-surface p-6 shadow-2xl sm:rounded-2xl"
    >
      <div class="flex items-center justify-between border-b border-theme-border pb-4">
        <h3 class="flex items-center gap-2 text-lg font-bold text-white">
          <span class="material-symbols text-indigo-400">cloud_upload</span>
          <span>Upload Video</span>
        </h3>
        <button
          onclick={() => (appState.uploadDrawerOpen = false)}
          class="flex h-8 w-8 items-center justify-center rounded-lg text-theme-muted hover:bg-theme-card hover:text-white"
        >
          <span class="material-symbols text-xl">close</span>
        </button>
      </div>

      <div
        role="region"
        aria-label="File Upload Dropzone"
        class="mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-theme-border p-8 text-center transition-colors {isDragging ? 'border-indigo-500 bg-indigo-500/10' : 'hover:border-slate-600 bg-theme-bg/50'}"
        ondragover={(e) => {
          e.preventDefault();
          isDragging = true;
        }}
        ondragleave={() => (isDragging = false)}
        ondrop={(e) => {
          e.preventDefault();
          isDragging = false;
          handleFileSelect(e.dataTransfer.files);
        }}
      >
        <span class="material-symbols text-4xl text-theme-muted">upload_file</span>
        <p class="mt-2 text-sm font-medium text-slate-200">
          Tarik & lepas file video ke sini, atau
        </p>
        <button
          onclick={() => fileInput?.click()}
          class="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-indigo-500"
        >
          Pilih File
        </button>
        <input
          bind:this={fileInput}
          type="file"
          multiple
          class="hidden"
          onchange={(e) => handleFileSelect(e.target.files)}
        />
        <p class="mt-2 text-[11px] text-theme-muted">
          Format wajib: MP4 (Codec H.264). Protokol TUS resumable.
        </p>
      </div>

      {#if uploadQueue.length > 0}
        <div class="mt-6 max-h-56 overflow-y-auto space-y-3 pr-1">
          {#each uploadQueue as item (item.id)}
            <div class="rounded-xl border border-theme-border bg-theme-card p-3 shadow-sm">
              <div class="flex items-start justify-between gap-2 text-xs">
                {#if item.status === 'staged'}
                  <div class="flex flex-1 flex-col gap-1.5 min-w-0">
                    <input
                      type="text"
                      bind:value={item.title}
                      placeholder="Judul video"
                      class="w-full rounded-lg border border-theme-border bg-theme-bg px-2.5 py-1 text-xs text-white outline-none focus:border-indigo-500"
                    />
                    <div class="flex items-center gap-2">
                      <select
                        bind:value={item.folderId}
                        class="rounded border border-theme-border bg-theme-bg px-2 py-0.5 text-[11px] text-slate-300 outline-none focus:border-indigo-500"
                      >
                        <option value="">Tanpa Folder</option>
                        {#each appState.folders as f}
                          <option value={f.id}>{f.name}</option>
                        {/each}
                      </select>
                      <span class="text-[10px] text-theme-muted truncate">{item.name} &bull; {formatBytes(item.size)}</span>
                    </div>
                  </div>
                {:else}
                  <div class="flex flex-1 flex-col min-w-0">
                    <span class="font-semibold text-slate-200 truncate">{item.title || item.name}</span>
                    <span class="text-[11px] text-theme-muted">{formatBytes(item.size)}</span>
                  </div>
                {/if}
                <button
                  onclick={() => cancelUpload(item)}
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-theme-muted hover:bg-theme-border hover:text-white cursor-pointer"
                  title="Batalkan"
                >
                  <span class="material-symbols text-sm">close</span>
                </button>
              </div>

              {#if item.status === 'uploading'}
                <div class="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    class="h-full rounded-full bg-indigo-500 transition-all duration-300"
                    style={`width: ${item.displayProgress || item.progress}%`}
                  ></div>
                </div>
                <div class="mt-1.5 flex items-center justify-between text-xs text-slate-300">
                  <span class="font-medium text-slate-200">
                    {formatBytes(item.displaySent || item.bytesSent || 0)} / {formatBytes(item.size)} &bull; {item.displayProgress || item.progress}%
                  </span>
                  <span class="text-slate-400">
                    {formatBytes(item.speed || 0)}/s &bull; ETA: {fmtEta(item.displayEta || item.eta)}
                  </span>
                </div>
              {:else if item.status === 'staged'}
                <div class="mt-1 flex items-center justify-between text-[11px] text-amber-400">
                  <span class="flex items-center gap-1">
                    <span class="material-symbols text-xs">edit_note</span>
                    <span>Siap diunggah &bull; Tekan tombol Mulai Upload di bawah</span>
                  </span>
                </div>
              {:else if item.status === 'queued'}
                <div class="mt-1 flex items-center gap-1 text-[11px] text-theme-muted">
                  <span class="material-symbols text-xs">hourglass_empty</span>
                  <span>Menunggu giliran antrian...</span>
                </div>
              {:else if item.status === 'done'}
                <div class="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                  <span class="material-symbols text-sm">check_circle</span>
                  <span>Selesai &bull; Siap diproses server</span>
                </div>
              {:else if item.status === 'error'}
                <div class="mt-1 text-[11px] text-rose-400">
                  Error: {item.error}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="mt-6 flex items-center justify-between">
        {#if stagedCount > 0}
          <button
            onclick={startUploadAll}
            disabled={isUploading}
            class="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <span class="material-symbols text-base">play_arrow</span>
            <span>Mulai Upload ({stagedCount})</span>
          </button>
        {:else if isUploading}
          <span class="flex items-center gap-2 text-xs font-medium text-indigo-400">
            <span class="material-symbols animate-spin text-base">progress_activity</span>
            <span>Mengunggah antrian...</span>
          </span>
        {:else}
          <div></div>
        {/if}

        <button
          onclick={() => (appState.uploadDrawerOpen = false)}
          class="rounded-xl border border-theme-border px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-theme-card cursor-pointer transition-colors"
        >
          Tutup
        </button>
      </div>
    </div>
  </div>
{/if}
