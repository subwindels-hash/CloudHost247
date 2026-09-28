import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds the production React/TypeScript SPA into ../public, which the Fastify server
 * (src/app.ts) serves as static assets and falls back to for client-side routing.
 *
 * There is no production dependency on Vite's dev server — `npm run build` produces plain
 * static HTML/CSS/JS that Node/Apache serve directly, satisfying the cPanel deployment
 * requirement to never run `vite dev`/`npm run dev` in production.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ready': 'http://localhost:3000',
    },
  },
});
