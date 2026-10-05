import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds the React dashboard into spa/dist. The monolith (platform/server.js) serves that folder
 * under /app and falls back to its index.html for client-side routes, so a refresh inside the SPA
 * never 404s.
 *
 * base is '/app/' so every emitted asset URL is rooted there, matching how the monolith mounts it.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ready': 'http://localhost:3000',
    },
  },
});
