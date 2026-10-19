<script>
  import { appState } from '../lib/state.svelte.js';
  import { uploadTusFile } from '../lib/tus.js';
  import { fmt, formatBytes } from '../lib/utils.js';

  let fileInput = $state(null);
  let isDragging = $state(false);
  let isUploading = $state(false);
  let currentUpload = $state(null);
  let uploadQueue = $state([]);

  function handleFileSelect(files) {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      uploadQueue.push({
        id: Math.random().toString(36).slice(2),
        file: f,
        name: f.name,
        size: f.size,
        progress: 0,
        status: 'queued',
        error: null,
      });
    }
    processQueue();
  }

  async function processQueue() {
    if (isUploading) return;
    const nextItem = uploadQueue.find((item) => item.status === 'queued');
    if (!nextItem) return;

    isUploading = true;
    nextItem.status = 'uploading';
    currentUpload = nextItem;

    try {
      await uploadTusFile(nextItem.file, appState.activeFolderId, (prog) => {
        nextItem.progress = prog.progress;
        nextItem.speed = prog.speed;
        nextItem.eta = prog.eta;
      });
      nextItem.status = 'done';
      appState.addToast(`Upload selesai: ${nextItem.name}`, 'success');
    } catch (err) {
      nextItem.status = 'error';
      nextItem.error = err.message;
      appState.addToast(`Gagal: ${err.message}`, 'error');
    } finally {
      isUploading = false;
      currentUpload = null;
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
          accept="video/*"
          multiple
          class="hidden"
          onchange={(e) => handleFileSelect(e.target.files)}
        />
        <p class="mt-2 text-[11px] text-theme-muted">
          Format wajib: MP4 (Codec H.264). Protokol TUS resumable.
        </p>
      </div>

      {#if uploadQueue.length > 0}
        <div class="mt-6 max-h-48 overflow-y-auto space-y-3">
          {#each uploadQueue as item (item.id)}
            <div class="rounded-lg border border-theme-border bg-theme-card p-3">
              <div class="flex items-center justify-between text-xs">
                <span class="font-semibold text-slate-200 line-clamp-1">{item.name}</span>
                <span class="text-theme-muted">{formatBytes(item.size)}</span>
              </div>

              {#if item.status === 'uploading'}
                <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    class="h-full rounded-full bg-indigo-500 transition-all duration-300"
                    style={`width: ${item.progress}%`}
                  ></div>
                </div>
                <div class="mt-1 flex items-center justify-between text-[11px] text-theme-muted">
                  <span>{item.progress}% &bull; {formatBytes(item.speed || 0)}/s</span>
                  <span>ETA: {fmt(item.eta || 0)}</span>
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
              {:else}
                <div class="mt-1 text-[11px] text-theme-muted">
                  Menunggu antrian...
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="mt-6 flex justify-end">
        <button
          onclick={() => (appState.uploadDrawerOpen = false)}
          class="rounded-lg border border-theme-border px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-theme-card"
        >
          Tutup
        </button>
      </div>
    </div>
  </div>
{/if}
