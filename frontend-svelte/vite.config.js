import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4100',
      '/stream': 'http://localhost:4100',
      '/thumb': 'http://localhost:4100',
      '/storyboard': 'http://localhost:4100',
      '/clip': 'http://localhost:4100',
      '/download': 'http://localhost:4100',
      '/webdav': 'http://localhost:4100',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
