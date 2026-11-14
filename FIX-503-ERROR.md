# Fix Persistent `Error 503. Service Unavailable` on cPanel / CloudLinux Passenger

## Symptom

Visiting your CloudHost247 domain shows the CloudLinux Passenger error page:

> **Error 503. Service Unavailable**
> The server is temporarily unavailable. Please check back shortly. If this problem persists, please contact our Technical Support department.

This page is rendered by Apache + Phusion Passenger whenever the Node.js startup process (`server.js`) exits during boot, exceeds Passenger's startup timeout before binding `PORT`, fails to bind a Passenger Unix domain socket, or hits CloudLinux LVE memory/thread limits.

---

## What Was Fixed in the Application (`cloudhost247-node/` & `platform/`)

1. **Immediate HTTP listener before any recovery build (`cloudhost247-node/server.js`)**
   - Previously, when `dist/src/server.js` or `public/index.html` was missing on the server, `server.js` ran `execFileSync` (blocking the event loop for 60–180 seconds before calling `listen()`), causing Passenger to kill the process and return HTTP `503`.
   - `server.js` now binds `PORT` / `SOCKET_PATH` immediately (< 1 second), serves `200 OK` warmup responses while running a low-memory (~70 MB) background transpilation + frontend build, and hot-mounts Fastify in place as soon as the build completes.
   - Stale `.server-build-lock` directories left behind by SIGKILLed workers now record `{ pid }` and are automatically reclaimed when the owning PID is no longer alive.

2. **CloudLinux LVE memory & thread-limit protection**
   - `UV_THREADPOOL_SIZE`, `RAYON_NUM_THREADS`, `VIPS_CONCURRENCY`, and `GOMAXPROCS` are capped before native modules load so `EAGAIN` thread-creation panics do not crash Passenger workers on shared cPanel plans.
   - Heavy native/memory-intensive modules (`geoip-lite`, `sharp`, `@napi-rs/canvas`) are now lazy-loaded on first request instead of at startup, cutting idle startup RSS by ~180 MB (from ~402 MB down to ~221 MB).

3. **Zero-crash cPanel environment handling (`cloudhost247-node/src/config/env.ts` & `src/server.ts`)**
   - **Preloads `.env` automatically** from `<APP_ROOT>/.env` even when cPanel's Setup Node.js App launches `node server.js` from a different working directory without injecting `.env`.
   - **Unix domain sockets in `PORT`**: When CloudLinux Passenger injects `PORT=/tmp/passenger.<id>.sock` (instead of a numeric TCP port), both `server.js` and `src/config/env.ts` automatically route it to `SOCKET_PATH` instead of failing numeric port validation.
   - **Scheme-less `APP_URL` & blank cPanel UI rows**: Bare hostnames such as `APP_URL=cloudhost247.com` are normalized to `https://cloudhost247.com`, and empty environment rows (`DATABASE_URL=""`) are treated as unset.
   - **Graceful startup without `JWT_SECRET` or `DATABASE_URL`**: Missing `JWT_SECRET` generates an ephemeral per-process secret with a critical log warning instead of `process.exit(1)`. Missing `DATABASE_URL` boots the website, health checks, and stateless tools cleanly while returning `503 DATABASE_NOT_CONFIGURED` JSON only on database-backed API endpoints.
   - **Diagnostic fallback on malformed env vars**: If an explicitly set variable is invalid (for example `DATABASE_URL=mysql://...`), the server stays alive on a secret-free setup-diagnostic page instead of crash-looping into Passenger's generic 503 screen.

4. **Pre-built cPanel release archive (`cloudhost247-node/scripts/package-cpanel.sh`)**
   - Now includes `config/` alongside `dist/`, `public/`, `manifests/`, `database/migrations/`, `server.js`, `package.json`, and `package-lock.json`.

5. **Legacy `platform/` compatibility (`platform/.htaccess`, `platform/server.js`, `platform/src/core/config.js`)**
   - Removed hardcoded `PassengerAppRoot` / `PassengerEnabled` directives from `platform/.htaccess` that broke Apache when managed by cPanel Application Manager, lowered the Node runtime floor to Node.js `>= 20.9.0`, and added Passenger Unix socket `PORT` + bare `APP_URL` support.

---

## Deploying / Recovering on cPanel (`cloudhost247-node`)

### Option A — Recommended: Deploy Pre-Built cPanel Package (No Server Build Needed)

1. Build the deployment archive on CI or a workstation:
   ```bash
   cd cloudhost247-node
   bash scripts/package-cpanel.sh
   ```
2. Upload `cloudhost247-node/release/cloudhost247-cpanel-<sha>.zip` to your cPanel **Application root** (for example `/home/<cpanel_user>/cloudhost247-node`) and **Extract** its contents directly into `<APP_ROOT>` so `server.js`, `package.json`, `dist/src/server.js`, and `public/index.html` sit at `<APP_ROOT>/`.
3. In **cPanel -> Software -> Setup Node.js App**:
   - **Node.js version**: `20.x` or `22.x` (`>= 20.9.0`)
   - **Application mode**: `Production`
   - **Application root**: `cloudhost247-node` (matching where `server.js` lives)
   - **Application startup file**: `server.js`
4. Click **Run NPM Install** (or enter the virtual environment via SSH and run `npm ci --omit=dev`).
5. Configure your production environment variables (`DATABASE_URL`, `JWT_SECRET`, `APP_URL`) in the cPanel UI or `<APP_ROOT>/.env` — see [`docs/CPANEL_DEPLOYMENT.md`](docs/CPANEL_DEPLOYMENT.md) for the full list.
6. Click **Restart** (or run `mkdir -p tmp && touch tmp/restart.txt` inside `<APP_ROOT>`).

### Option B — Recovery on an Existing Server Checkout

1. Pull or upload the updated files (`server.js`, `package.json`, `dist/`, `public/`, `config/`).
2. Ensure no stale lock or broken `.htaccess` overrides cPanel's Application Manager:
   - Do **not** manually add `PassengerAppRoot` or `PassengerNodejs` with `/home/username/...` placeholders to `.htaccess` — cPanel's **Setup Node.js App** manages the `# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION BEGIN` block automatically.
3. Restart Passenger:
   ```bash
   cd ~/cloudhost247-node
   rm -rf .server-build-lock
   mkdir -p tmp && touch tmp/restart.txt
   ```
4. Verify health:
   - Visit `https://<your-domain>/health` -> expects `{"status":"ok"}` (or `{"status":"starting",...}` briefly if compiling for the first time).
   - Visit `https://<your-domain>/ready` -> expects `{"status":"ok","checks":{"database":"ok"}}` once PostgreSQL `DATABASE_URL` is configured and reachable.

For full cPanel/Passenger setup, PostgreSQL configuration, migrations, and operational checks, see [`docs/CPANEL_DEPLOYMENT.md`](docs/CPANEL_DEPLOYMENT.md).
