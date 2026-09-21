import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
// On the pod this app is served by nginx from a subpath, not from a host of its own, so every asset URL has to
// carry that prefix — a build with base '/' asks for /assets/... and collides with ComfyUI's own /assets.
// Output goes to lab/dist, which is what the image ships and the volume keeps.
export default defineConfig({
    base: '/lab/',
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
