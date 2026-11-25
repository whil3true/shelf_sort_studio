import { statSync } from 'node:fs';
import { defineConfig } from 'vite';
import { resolveArtPaths } from './src/ui/ArtAssets.ts';

export default defineConfig({
  base: './',
  define: {
    __STUDIO_ART_PATHS__: JSON.stringify(resolveArtPaths(path =>
      statSync(new URL(`./public/${path}`, import.meta.url), { throwIfNoEntry: false })?.isFile() === true)),
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
  },
});
