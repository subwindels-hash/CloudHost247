import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { editorialPunctuationPlugin } from './editorial-punctuation-plugin';

/**
 * Builds the production React/TypeScript SPA into ../public, which the Fastify server
 * (src/app.ts) serves as static assets and falls back to for client-side routing.
 *
 * There is no production dependency on Vite's dev server — `npm run build` produces plain
 * static HTML/CSS/JS that Node/Apache serve directly, satisfying the cPanel deployment
 * requirement to never run `vite dev`/`npm run dev` in production.
 */

/** Where the API is running. `npm run dev` starts both halves; this only needs changing if the
 *  server is deliberately run on another port or host. */
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3000';

/**
 * Proxies the API, and answers *in JSON* when there is nothing behind it.
 *
 * Vite's own handler for a failed proxy writes `500 text/plain` with an **empty body**. That is
 * the least useful possible answer for a `fetch()`: `res.json()` throws `Unexpected end of JSON
 * input`, the page has nothing to quote, and a visitor reading the Tools Center is left with a
 * parser complaint about an API they cannot see. `configure` runs before Vite registers its own
 * `error` listener, so responding here wins — and Vite's handler then skips (it checks
 * `headersSent`/`writableEnded`).
 *
 * The same options are used for `server` and for `preview`, so `vite preview` — which serves the
 * built SPA and would otherwise answer `/api/*` with `index.html` — behaves identically.
 */
function apiProxy() {
  return {
    target: API_TARGET,
    changeOrigin: true,
    /**
     * Act as a *correctly configured* edge for the API behind us: append the address this proxy
     * observed to X-Forwarded-For, the way a sane Apache/nginx/Cloudflare setup does. Without it the
     * API sees only this dev server's socket and the menu-bar IP detector can never verify an
     * address, however the outer preview proxy behaves. Appending (not overwriting) is what makes
     * the chain authoritative: `resolveVisitorIpDetail` walks it right-to-left and stops at the
     * first untrusted hop, so anything a client prepends is ignored. Production never runs Vite.
     */
    xfwd: true,
    configure(proxy: { on: (event: string, handler: (...args: unknown[]) => void) => void }) {
      proxy.on('error', (_error: unknown, _request: unknown, response: unknown) => {
        const res = response as {
          headersSent?: boolean;
          writableEnded?: boolean;
          writeHead?: (status: number, headers: Record<string, string>) => { end: (body: string) => void };
          end?: () => void;
        } | null;
        if (!res || res.headersSent || res.writableEnded || typeof res.writeHead !== 'function') return;
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }).end(
          JSON.stringify({
            error: 'API_UNAVAILABLE',
            message: `The CloudHost247 API is not reachable at ${API_TARGET}. Start it with \`npm run dev:server\` (\`npm run dev\` starts both halves) and reload this page.`,
          }),
        );
      });
    },
  };
}

const proxy = {
  '/api': apiProxy(),
  '/health': apiProxy(),
  '/ready': apiProxy(),
};

export default defineConfig({
  root: __dirname,
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [editorialPunctuationPlugin(), react()],
  // The Barcode Scanner loads its decoder only when someone starts to scan. Left to discover that
  // import by itself, the dev server would prepare the library at that moment and reload the page,
  // throwing away the first scan. Naming both decoders here prepares them at start-up. Production
  // builds are unaffected: they bundle each as a chunk of the scanner page either way.
  optimizeDeps: { include: ['@zxing/library', 'zxing-wasm/reader'] },
  build: {
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy,
  },
});
