<script>
  import { appState } from '../lib/state.svelte.js';
</script>

<div class="fixed bottom-20 right-4 z-50 flex flex-col gap-2 pointer-events-none md:bottom-6">
  {#each appState.toasts as toast (toast.id)}
    <div
      class="pointer-events-auto flex items-center gap-2 rounded-xl border border-theme-border bg-theme-surface/95 px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-md transition-all animate-bounce duration-300 {toast.type === 'error' ? 'text-rose-400 border-rose-500/30' : toast.type === 'success' ? 'text-emerald-400 border-emerald-500/30' : 'text-slate-100'}"
    >
      <span class="material-symbols text-lg">
        {toast.type === 'error' ? 'error' : toast.type === 'success' ? 'check_circle' : 'info'}
      </span>
      <span>{toast.message}</span>
    </div>
  {/each}
</div>
