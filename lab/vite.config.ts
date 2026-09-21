import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Served from a subpath on the pod, never from a host of its own. A relative base keeps the asset URLs
// relative to wherever index.html lands, so one build works under /lab/ and under /ygo/app/lab/ alike — and it
// cannot collide with ComfyUI's own /assets, which a base of '/' would.
// Output goes to lab/dist, which is what the image ships and the volume keeps.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: { port: 5173, host: true },
});
