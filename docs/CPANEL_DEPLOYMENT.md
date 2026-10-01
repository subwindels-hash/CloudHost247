# CloudHost247 Node Platform — cPanel Deployment Guide

This document covers deploying, updating, and operating the new independent Node.js/TypeScript
platform (`cloudhost247-node/`) on **cPanel shared hosting only**, using cPanel's Application
Manager (Passenger) and Apache reverse-proxy integration. It assumes **no root access, no WHM
access, no Docker/Kubernetes/systemd**, and no ability to open arbitrary ports.

This platform is being introduced incrementally alongside the existing WHMCS/PHP stack (see
repo root `modules/`, `templates/`, `crons/`). **Do not delete or disable any WHMCS
functionality** as part of this deployment — the two stacks run side by side until each
replaced feature has passed acceptance testing on staging (see `docs/independent-rebuild/` for
the PHP-side rebuild notes, which are a separate, earlier effort and are not reused by this Node
app).

> **Status of this document — cPanel staging verification: BLOCKED, not performed.**
>
> Phase 1 (commit `3523035c5817b857eb2917c188db2452bebab35a` on
> `arena/01a0e82a-cloudhost247`) built, typechecked, and passed its full automated test suite
> (40/40) in a clean `git clone` + `npm ci`, and was exercised end-to-end against a **local
> Postgres-wire-protocol test database** (PGlite) in the development sandbox. **None of that is
> cPanel verification.** No real cPanel account, WHM access, or hosting credentials have been
> available to this work at any point, so the following have **not** been performed and must not
> be assumed or fabricated:
>
> - Deployment through a real cPanel "Setup Node.js App" / Passenger instance
> - Confirmation of actual cPanel version, Apache version, Node.js Selector versions, or npm
>   version on any real host
> - Real Apache reverse-proxy behavior for direct navigation/refresh on the SPA routes
> - Real PostgreSQL availability/configuration on an actual cPanel account or its approved
>   external alternative
> - Review of real Passenger/cPanel error logs for credential leakage
> - Any item in the Appendix C checklist below — **all 18 items remain unchecked**
>
> **This gate is explicitly known and was not silently skipped:** the project owner was informed
> of this exact blocker and made an informed decision to let Phase 2 (public website / shared
> application shell) proceed in parallel while this gate stays open, on the explicit condition
> that **no part of this platform is described as "cPanel-ready" or "production-ready" until a
> real cPanel staging run closes every item below.** If you are picking this up later: do the
> real cPanel run before relying on this in production, regardless of how much Phase 2/3 work has
> since been layered on top.

---

## 0. Prerequisites and things to verify before you start (never assume)

Before deploying, confirm the following **on the actual target cPanel account** — do not assume
any of these from this document, from prior hosts, or from local development:

1. **cPanel has "Setup Node.js App" (Application Manager / Passenger)** under the Software
   section. If it's missing, the host either doesn't support Node.js apps or the feature is
   disabled by the provider — you cannot proceed without it (and you cannot install Passenger
   yourself without root).
2. **Which Node.js versions the Node Selector actually offers.** Open *Setup Node.js App* →
   *Create Application* → *Node.js version* dropdown and record the exact list. This app requires
   **Node.js 20.9.0 or newer** (Fastify v5, one of this app's core dependencies, dropped support
   for Node 18 and earlier — see `cloudhost247-node/package.json` `engines.node`). If the host
   only offers Node 18 or older, you cannot deploy this app as-is on that host; escalate to the
   hosting provider or reconsider the dependency versions before deploying.
3. **Whether the account has cPanel-hosted PostgreSQL** ("PostgreSQL Databases" icon in cPanel)
   or whether you'll point `DATABASE_URL` at an external managed Postgres provider. Either is
   supported — see section 4.
4. **SSH/terminal access** (cPanel "Terminal" app, or real SSH if the account has it) — needed to
   run `npm ci` and the build/migration commands. If the account has no terminal at all, the
   hosting provider must confirm how they expect npm installs/builds to be run (some cPanel
   Application Manager UIs offer an "NPM Install" and "Run JS Script" button that can substitute
   for a terminal — check for that if SSH/Terminal is unavailable).
5. **The exact application root path**, e.g. `/home/<cpaneluser>/cloudhost247`. Never hardcode
   `/home/username/` anywhere in the app or these docs — every path below is written as
   `<APP_ROOT>` for this reason, and the app itself only ever uses `process.cwd()` /
   `__dirname`-relative paths, never a hardcoded home directory.

---

## 1. Directory layout on the server

The production application root (`<APP_ROOT>`, e.g. `/home/cpaneluser/cloudhost247`) mirrors the
`cloudhost247-node/` directory in this repository:

```
<APP_ROOT>/
  server.js              # Passenger/Application Manager startup file (do not rename)
  package.json
  package-lock.json
  .env                   # created on the server only — never committed to Git
  src/                    # TypeScript source, compiled to dist/ by the build step
  dist/                   # build output (git-ignored, produced by `npm run build`)
  frontend/               # React + Vite + TS source, built into public/
  public/                 # built static frontend assets, served by the Node app + Apache
  database/
    migrations/           # versioned .sql migration files
    migrate.ts             # migration CLI (compiled to dist/database/migrate.js)
  tests/
```

`<APP_ROOT>` is whatever path you choose in cPanel's "Setup Node.js App" screen — nothing in the
codebase assumes a specific username or path.

---

## 2. First-time setup (initial deployment)

1. **Get the code onto the server.** Either:
   - `git clone` the repository into `<APP_ROOT>` (requires the host to allow outbound git over
     HTTPS/SSH from a terminal), or
   - Upload a release archive of the `cloudhost247-node/` subtree via cPanel File Manager / FTP
     and extract it into `<APP_ROOT>`.

   Only the contents of `cloudhost247-node/` belong at `<APP_ROOT>` — do not copy the WHMCS PHP
   tree into the same directory as the Node app.

2. **Create the Node.js application in cPanel:**
   - cPanel → *Software* → *Setup Node.js App* → *Create Application*.
   - **Node.js version:** pick the newest available version that is `>= 20.9.0` (see section 0,
     item 2). Record which version you picked — it matters for reproducing bugs later.
   - **Application mode:** `Production`.
   - **Application root:** `<APP_ROOT>` (relative to the home directory, e.g. `cloudhost247`).
   - **Application URL:** the domain/subdomain/path this app should answer on (e.g.
     `app.cloudhost247.com` or `cloudhost247.com/app`, per your rollout plan — see section 7 for
     how this interacts with existing WHMCS URLs).
   - **Application startup file:** `server.js` (the repo-root startup file described in section
     3 — do not point this at `src/server.ts` or `dist/src/server.js` directly).
   - Click *Create*. cPanel writes an entry into `.htaccess`/Apache config to proxy the
     Application URL to the Passenger-managed Node process, and creates a dedicated virtual
     environment for this app (its own `node_modules`, reachable via the "Enter to virtual
     environment" command cPanel shows on the app's detail page).

3. **Set environment variables** on the application's detail page ("Environment Variables"
   section of *Setup Node.js App*) — see section 5 for the full list and what each does. Do this
   through the cPanel UI, not by hand-editing a committed file; the only committed file is
   `.env.example`, which lists variable **names** only.

4. **Install dependencies from the lockfile.** Open the app's "virtual environment" terminal
   (cPanel shows the exact `source ... && cd ...` command to run on its detail page) and run:

   ```
   npm ci
   ```

   `npm ci` installs exactly what's in `package-lock.json` — never `npm install` for a first
   deploy or a dependency-changing deploy, to avoid silently drifting from the versions that were
   tested in CI.

5. **Build the server and frontend:**

   ```
   npm run build
   ```

   This runs `tsc` (compiling `src/` and `database/` into `dist/`) and `vite build` (compiling
   `frontend/` into `public/`). The app **never** runs `npm run dev` or a Vite dev server in
   production — Passenger only ever executes the compiled `dist/src/server.js` via `server.js`.

6. **Verify environment variables are complete** before starting the app:

   ```
   npm run env:check
   ```

   This fails fast with a clear message if a required variable (e.g. `DATABASE_URL`,
   `JWT_SECRET`) is missing or malformed, instead of letting Passenger crash-loop the process.

7. **Run the database migrations** — see section 6 for the full explicit, controlled procedure.
   Do this before first starting the app against a fresh database.

8. **Start the application** from the *Setup Node.js App* page ("Restart" button — cPanel starts
   a stopped app the same way). Passenger runs `server.js`, which `require()`s
   `dist/src/server.js`; that file reads `process.env.PORT` (which Passenger injects — you never
   set `PORT` yourself in production; see section 5).

9. **Verify the deployment:**
   - Visit the Application URL in a browser; the React SPA shell should load (see section 8 for
     the shipped routes).
   - `curl https://<your-app-url>/health` → expect `200` with a small JSON body and no sensitive
     data.
   - `curl https://<your-app-url>/ready` → expect `200` if the database is reachable, `503`
     otherwise (this is the dependency check endpoint — see section 8).
   - Register a test account through `/register` and confirm login works end-to-end against the
     real database.
   - Check the app's error log from the *Setup Node.js App* detail page (or `<APP_ROOT>/stderr.log`
     if cPanel writes one) for unexpected errors.

---

## 3. `server.js` — why it looks the way it does

`<APP_ROOT>/server.js` is plain CommonJS JavaScript, not TypeScript, because Passenger executes
it directly with the Node.js binary you selected in *Setup Node.js App* — there is no build step
between "Passenger starts the app" and "your code runs" for this one file. Its only job is:

1. Confirm `dist/src/server.js` exists (i.e. `npm run build` has been run) and fail with a clear,
   actionable message if not — rather than a confusing stack trace deep in a missing-file error.
2. `require()` the compiled entry point.

All real application logic (the Fastify server, routes, database access) lives in
`src/server.ts` → compiled to `dist/src/server.js`, which:

- Reads the TCP port to listen on from `process.env.PORT` — **Passenger sets this
  automatically** for the app instance it manages; you must never hardcode a port number in
  production. A hardcoded fallback (`3000`) exists only for local `npm run dev`, and is not used
  when `PORT` is set (which it always will be under Passenger).
- Binds to the interface Passenger expects (loopback) — Apache's `mod_passenger` proxies external
  HTTPS traffic on your domain to this internal process; the app itself never needs (and must
  never attempt) to open a public-facing port directly.

---

## 4. Database: PostgreSQL on cPanel or an external provider

This app speaks to PostgreSQL exclusively through a single `DATABASE_URL` connection string
(`postgresql://user:password@host:port/database`). It **never** hardcodes a host, username,
password, database name, or SSL mode anywhere in source code — everything comes from
`DATABASE_URL` (plus `DATABASE_SSL` / `DATABASE_SSL_REJECT_UNAUTHORIZED` for TLS behavior; see
`.env.example`). This makes it equally possible to run against:

- **cPanel-hosted PostgreSQL**, if the account's cPanel exposes a "PostgreSQL Databases" icon
  (not all shared-hosting plans include PostgreSQL — some only offer MySQL/MariaDB). If
  available:
  1. Create a database and a **dedicated, least-privilege** database user through that cPanel
     tool (do not reuse a broad/admin-level DB user).
  2. Grant that user only the privileges this app needs on its own database/schema — avoid
     granting superuser or cross-database privileges.
  3. Build `DATABASE_URL` from the host/port/db/user/password cPanel shows you (commonly
     `localhost:5432` for a same-account Postgres instance — confirm the actual host/port from
     cPanel, don't assume `localhost`).
- **An external managed PostgreSQL provider** (e.g. a managed Postgres service outside the cPanel
  account), if the shared-hosting plan has no PostgreSQL support at all, or if you prefer to keep
  the database off the shared web-hosting box. Use that provider's connection string as
  `DATABASE_URL` and set `DATABASE_SSL=true` (most external providers require TLS).

The app **never requires PostgreSQL server extensions** (e.g. `pgcrypto`) to be installed —
primary-key UUIDs are generated application-side via Node's built-in `crypto.randomUUID()`
(`src/db/users.ts`), which keeps the schema deployable on restrictive managed/shared Postgres
instances where you cannot run `CREATE EXTENSION`.

---

## 5. Environment variables

Configure these through *Setup Node.js App*'s "Environment Variables" editor (preferred) — the
committed `cloudhost247-node/.env.example` file lists the same names with **no real values**, for
local development reference only. Never commit a real `.env` file.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | Set to `production` on cPanel. Controls stricter validation, cookie/security defaults, and gates the migration CLI's destructive-action confirmation (section 6). |
| `PORT` | no (prod) | **Do not set this on cPanel** — Passenger injects it. Only used as a local dev fallback (defaults to `3000`) when nothing else sets it. |
| `APP_URL` | yes | The public HTTPS URL of this app, e.g. `https://cloudhost247.com`. Used for CORS/security headers, never for routing. |
| `DATABASE_URL` | yes | Full Postgres connection string — see section 4. Never split into separate host/user/password variables. |
| `DATABASE_SSL` | yes | `true`/`false`. Set `true` for any external managed provider; check with the provider/cPanel docs for same-account Postgres. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | yes | Normally `true`. Only set `false` if your provider's docs explicitly require it for a self-signed chain — this weakens TLS verification, so treat it as an exception, not a default. |
| `DATABASE_POOL_MAX` | no | Defaults to a small pool (`5`) suitable for shared hosting's connection limits. Raise only after confirming the account's Postgres connection limit. |
| `JWT_SECRET` | yes | Long random secret used to sign auth tokens. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and store only in cPanel's environment variable editor. |
| `JWT_EXPIRES_IN` | no | Defaults to `12h`. |
| `CRON_JOB_TOKEN` | reserved | Reserved for future authenticated HTTP job endpoints. The current queue/notification/reconciliation worker is invoked as a lease-protected CLI one-shot from cPanel Cron; see section 9. |
| `LOG_LEVEL` | no | Defaults to `info`. Structured JSON logs (`pino`) are written to stdout, which cPanel/Passenger captures to the app's log file. |

**After changing any environment variable, you must restart the application** (*Setup Node.js
App* → *Restart*) — Passenger does not hot-reload environment variables into a running process.

---

## 6. Database migrations (explicit, controlled — never automatic)

Migrations are plain, versioned `.sql` files in `database/migrations/` (e.g.
`0001_create_users.sql`), applied by the compiled CLI at `dist/database/migrate.js`. **The
application server never runs migrations on startup** — `src/server.ts` only connects to the
database to serve requests; running a migration is always a separate, explicit, operator-invoked
command.

Commands (run from `<APP_ROOT>`, after `npm run build`):

```
node dist/database/migrate.js status    # lists applied vs. pending migrations — read-only
node dist/database/migrate.js verify    # checksum-verifies already-applied migrations — read-only
node dist/database/migrate.js up        # applies pending migrations
node dist/database/migrate.js create <name>   # scaffolds a new empty migration file
```

(`npm run migrate:status` / `npm run migrate:verify` / `npm run migrate` / `npm run migrate:create`
are shorthands for the same commands, defined in `package.json`.)

Design guarantees, enforced by `database/migrate.ts`:

- Each migration file runs inside its own database transaction; a failing migration rolls back
  cleanly instead of leaving the schema half-applied.
- Applied migrations are checksummed (`schema_migrations` table); if a previously-applied
  migration file's contents change on disk, `verify`/`status` reports drift instead of silently
  re-running or "fixing" it.
- **When `NODE_ENV=production`, `up` refuses to apply anything unless you explicitly confirm**,
  via `--yes` or `CONFIRM_MIGRATION=yes`:

  ```
  CONFIRM_MIGRATION=yes node dist/database/migrate.js up
  ```

  This exists specifically so a migration can never run as an accidental side effect of another
  command or a copy-pasted script in production.
- The migration runner never contains, and must never be extended to contain, a destructive
  operation such as `DROP DATABASE`, an unscoped `TRUNCATE`, or a "reset/reseed" step. Rolling
  back a bad migration in production means writing and applying a new forward-only migration that
  undoes the change, after restoring from a backup if data was lost.

**Required procedure for a production migration** (do all of these, in order, every time):

1. **Verify connectivity:** `node dist/database/migrate.js status` — confirms `DATABASE_URL`
   resolves and the target database is reachable, and shows exactly what would change.
2. **Verify environment:** `npm run env:check` — confirms `NODE_ENV=production` and required
   secrets are set, so you know which safety gate (`CONFIRM_MIGRATION`) is active.
3. **Take a database backup** through your Postgres provider's backup mechanism (cPanel's
   PostgreSQL backup/export tool, or your external provider's snapshot/backup feature) — do this
   every time, not just for "big" migrations.
4. **Run the migration:** `CONFIRM_MIGRATION=yes node dist/database/migrate.js up`.
5. **Verify the schema:** `node dist/database/migrate.js verify` and `status` again — confirm the
   expected migrations are now applied and checksums match.
6. **Health check the app:** hit `/health` and `/ready` (section 8) and exercise the specific
   feature the migration supported, before considering the deploy complete.

---

## 7. Updating an already-deployed app: two different procedures

Treat these as **two distinct procedures** — using the dependency-changing one for a source-only
change (or vice versa) wastes time and adds risk; do not default to "delete node_modules and
reinstall" for routine updates.

### 7a. Source-only update (no changes to `package.json` / `package-lock.json`)

1. Pull/upload the new source (`git pull`, or re-upload the changed files) into `<APP_ROOT>`.
2. `npm run build` (recompiles `src/`, `database/`, and rebuilds the `frontend/` → `public/`
   assets).
3. Run `npm test` if you have a way to point it at a disposable/staging database (see section 10
   about not running the full suite against production data).
4. If the change includes new migrations, follow section 6's full procedure.
5. Restart the app from *Setup Node.js App* — **this step is not optional, even for a
   frontend-only change.** `@fastify/static` (which serves `public/`) is configured with
   `wildcard: false` (`src/app.ts`) so that unmatched paths correctly fall through to the SPA
   fallback instead of the static plugin swallowing them; the tradeoff is that `@fastify/static`
   builds its list of servable files **once, from the filesystem, when the plugin registers at
   process startup** — it does not notice files added, removed, or changed in `public/` while the
   process keeps running. If you rebuild the frontend without restarting the Node process, newly
   added or renamed files (e.g. a new hashed JS/CSS bundle filename from a fresh Vite build) will
   silently fall through to the SPA-shell fallback (still `200`, but the wrong body) instead of
   `404`ing obviously — always restart after `npm run build`, not just after a backend change.
6. Do **not** run `npm ci`/`npm install` and do **not** delete `node_modules` for this kind of
   update — `node_modules` only needs to change when the lockfile changes.

### 7b. Dependency-changing update (`package.json` / `package-lock.json` changed)

1. Pull/upload the new source **and** the updated `package.json` / `package-lock.json`.
2. `npm ci` — installs exactly what the new lockfile specifies. (It's safe to let `npm ci` replace
   `node_modules` here — that's the one case where a full reinstall is expected and necessary;
   this is different from repeatedly deleting `node_modules` as a routine troubleshooting step for
   unrelated problems, which this document does not recommend.)
3. `npm audit --omit=dev` — check the updated production dependency tree for known
   vulnerabilities before going further.
4. `npm run build`.
5. Run the **full test suite** (`npm test`, plus `npm run typecheck` and the frontend typecheck —
   see section 10) — a dependency change gets full verification, not just a smoke test.
6. If the change includes new migrations, follow section 6.
7. Restart the app from *Setup Node.js App*.

---

## 8. Endpoints and frontend routes

- `GET /health` — liveness probe. Always returns `200` with a minimal JSON body
  (`{ "status": "ok" }`-shaped) as long as the Node process is running; it does **not** check the
  database, so it can't be used to diagnose DB outages, and it never returns configuration,
  stack traces, or other sensitive data.
- `GET /ready` — readiness probe. Actually checks dependencies (currently: a database round-trip)
  and returns `200` when healthy or `503` when a dependency check fails — use this one for
  monitoring/alerting on real outages, and never expose secrets in its response body.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` — authentication
  foundation (bcrypt password hashing, JWT issuance/verification, an `auth_audit_log` table for
  login/registration events). Login and other sensitive routes are rate-limited (see below);
  repeated failed attempts return `429 Too Many Requests`, not a generic error.
- All other GET routes are handled by the React SPA (`frontend/`), built into `public/` and
  served by the Node app with a **server-side SPA fallback**. Shipped routes:
  - Phase 1 (auth foundation + authenticated-app placeholders): `/`, `/login`, `/register`,
    `/dashboard`, `/services`, `/domains`, `/billing`, `/invoices`, `/support`, `/admin`.
  - Phase 2 (public website + shared application shell): `/about`, `/hosting/cpanel`,
    `/legal/privacy-policy` — same shared `Header`/`Footer` shell as the rest of the app
    (`frontend/src/layout/`), and the same generic SPA-fallback mechanism, so **no server or
    Apache configuration changes are ever needed to add a new client-side route** — this was
    verified by adding these three routes without touching `src/app.ts`.

  Because the fallback is implemented in the Node app itself (`src/app.ts`'s
  `setNotFoundHandler`, using `@fastify/static`'s `reply.sendFile('index.html')`), **directly
  navigating to, or refreshing the browser on, any of those URLs works correctly** — the server
  always returns the SPA shell for unmatched `GET` requests that aren't `/api/*`, `/health`, or
  `/ready`, and React Router takes over client-side from there. This requires no `.htaccess`
  rewrite rules of its own; do not add conflicting Apache rewrite rules for these paths on top of
  what cPanel's Application Manager already wrote when you mounted the app.
- Security headers/CORS (`@fastify/helmet`, `@fastify/cors`) and rate limiting
  (`@fastify/rate-limit`) are applied globally to every route registered on the app (verified via
  `tests/unit/rate-limit.test.ts` and `tests/unit/spa-routing.test.ts`, and against a real
  Postgres-backed run — see section 10).
- **Content honesty notes for the Phase 2 public pages** (see `frontend/src/pages/`): the
  homepage hero copy and footer tagline reuse the real CloudHost247 brand defaults from
  `modules/addons/cloudhost247_theme/lib/ThemeRepository.php`; the About page and cPanel Hosting
  page contain newly-written, clearly-generic copy (no fabricated team bios, no invented
  pricing — the real product catalog and pricing remain in WHMCS until a later phase integrates
  them here); the Privacy Policy route uses a generic, explicitly-labeled placeholder component
  (`frontend/src/pages/LegalPage.tsx`) rather than fabricated legal text — the existing WHMCS
  `privacy-policy.php` remains the authoritative version until a reviewed replacement ships.

---


## 9. Scheduled worker — cPanel Cron one-shot only

The platform now has asynchronous deployments, notification delivery, subscription/dunning,
provider reconciliation, Cloudflare jobs, OS checks and Revenue Guardian automation. On cPanel
shared hosting these **must not** be run as an SSH-launched permanent `npm run worker` process:
cPanel cannot reliably supervise or restart such a daemon.

Instead, after a successful build and controlled migration, schedule the bounded CLI command below
once per minute in cPanel's **Cron Jobs** interface. Use the exact virtual-environment `node` path
shown by *Setup Node.js App*; do not guess it.

```cron
* * * * * cd <APP_ROOT> && /path/from/cpanel/node dist/src/worker/main.js --once >> /path/outside/webroot/cloudhost247-worker.log 2>&1
```

`npm run worker:once` is an equivalent local/operator shorthand. It performs one bounded cycle,
then exits. It does not start a daemon.

### Why overlapping Cron invocations are safe

- A one-shot cycle obtains the durable PostgreSQL lease in `worker_cycle_leases` before it runs.
  If a preceding cycle is still healthy, the new invocation logs a skip and exits successfully.
- The cycle lease is renewed while the cycle is running and expires automatically if its process
  dies, so a later Cron invocation can recover without an operator clearing an in-memory lock.
- Every deployment also retains its existing row-level lease and idempotency key. The cycle lease
  serializes periodic sweeps; it never replaces the per-job crash-recovery protection.
- A one-shot cycle exits non-zero on an unexpected error. Configure cPanel's Cron email or your
  log monitor to alert on that failure. Do **not** expose an unauthenticated HTTP `/cron` route.

Environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `WORKER_CONCURRENCY` | `4` | Maximum jobs drained in one worker cycle. Keep this low on shared hosting. |
| `WORKER_LEASE_MS` | `120000` | Per-deployment lease, renewed while a provider action runs. |
| `WORKER_ONCE_LEASE_MS` | `900000` | Cycle-wide Cron lease; renewed during the one-shot run. Must exceed the expected longest worker cycle. |
| `WORKER_ONCE` | `false` | Alternative to `--once` only for schedulers that cannot pass CLI arguments. Never set it for a supervised persistent worker. |

For a VM/container deployment with process supervision, `npm run worker` remains supported and
runs the same cycle continuously. Do not run both the persistent worker and cPanel's one-shot cron
against the same database unless you have deliberately designed that deployment topology.

---

## 10. Testing

- **Local/CI:** `npm run typecheck` (server), `npx tsc -p frontend/tsconfig.json --noEmit`
  (frontend), `npm test` (Vitest unit + integration tests, including a migration-runner
  integration test that exercises real SQL execution against an embedded Postgres-compatible
  engine — no network access required), `npm run build` (must succeed for both the server and the
  frontend). All of the above run in `.github/workflows/node-platform.yml` on every push/PR
  touching `cloudhost247-node/`.
- **What CI does *not* prove:** that the app behaves correctly under real cPanel/Passenger process
  management, real Apache reverse-proxy behavior, the account's actual Node.js Selector version,
  or a real production-shaped PostgreSQL instance (connection limits, latency, TLS
  configuration). Treat a green CI run as necessary, not sufficient, for calling this
  "cPanel-ready" — complete a real staging deployment on an actual cPanel account and re-run the
  smoke checks in section 2, step 9, before relying on this in production. Never claim
  "production ready" from a passing local/CI test run alone.
- **Never run the destructive parts of the test suite, or any dev-seed script, against a
  production database.** Point `DATABASE_URL` at a disposable/staging database when running
  `npm test` outside of local development.

---

## 11. Secrets and what must never be committed

- No real `DATABASE_URL`, `JWT_SECRET`, SMTP credentials, payment-provider keys, or any other
  secret is ever committed to Git. `.env.example` (committed) lists variable **names** only, with
  placeholder/empty values.
- Any real `.env` file used for local development stays untracked (`cloudhost247-node/.gitignore`
  excludes `.env*` except `.env.example`) and is never uploaded to the server as a substitute for
  configuring cPanel's environment variables UI — prefer the UI so secrets aren't sitting in a
  plaintext file that could be swept up by a backup/export tool. If a `.env` file is used on the
  server anyway (e.g. because the account's Application Manager doesn't expose an environment
  variable editor), it must have restrictive filesystem permissions and must never be placed
  inside `public/` or any other web-servable directory.

---

## Appendix A — cPanel terminology quick reference

| cPanel term | What it means here |
|---|---|
| Application Manager / "Setup Node.js App" | The screen used to create, configure, start/stop/restart, and view logs for this Node app; wraps Passenger. |
| Passenger | The process manager Apache uses to run and reverse-proxy to Node/Python/Ruby apps on cPanel; you never invoke it directly. |
| Application root | The directory on disk (e.g. `/home/cpaneluser/cloudhost247`) containing this app's files — set once per app in Application Manager. |
| Application URL | The public domain/subdomain/path Apache proxies to this app. |
| "Enter to virtual environment" | The `source`/`cd` command cPanel shows you to activate this app's own Node/npm binaries and `node_modules` inside a terminal session. |
| Node.js Selector / Node.js version dropdown | Where you pick which installed Node.js runtime this app uses — the available list is host-specific; always check it, never assume a version. |
| Cron Jobs | cPanel's scheduled-task UI (`crontab`-backed) — the only mechanism this project uses for recurring work; see section 9. |

## Appendix B — troubleshooting a Passenger crash-loop

1. Check *Setup Node.js App*'s log viewer / `<APP_ROOT>`'s Passenger log file first.
2. Run `npm run env:check` in the app's terminal — most crash-loops at first deploy are a missing
   or malformed environment variable.
3. Confirm `dist/src/server.js` exists (`npm run build` was actually run after the last code
   change) — `server.js` prints an explicit message and exits cleanly (not a stack trace) if this
   file is missing.
4. Confirm `DATABASE_URL` is reachable from the app's terminal (e.g.
   `node dist/database/migrate.js status`, which requires a working connection) — a database the
   app can't reach will fail `/ready` and any route touching the DB, though `/health` still
   returns `200` since it doesn't check dependencies (see section 8).

## Appendix C — 18-point cPanel acceptance checklist

This checklist must be satisfied, against a **real cPanel staging account**, before this
platform (or any subsequent phase of it) is described as "cPanel-ready" anywhere in project
communication. As of Phase 1, none of these have been exercised against a real cPanel account yet
(only against local TypeScript build/test tooling and a local Postgres-wire-protocol-compatible
test database) — this checklist is being published now specifically so that gap is visible and
trackable, not to claim it is already satisfied.

1. [ ] App created successfully via *Setup Node.js App* with the app root/URL/startup file
   exactly as documented in section 2.
2. [ ] Confirmed the actual Node.js version available and selected (`>= 20.9.0`) — recorded here:
   `______`.
3. [ ] `npm ci` completes cleanly inside the cPanel-provided virtual environment.
4. [ ] `npm run build` completes cleanly on the server (not just locally/in CI).
5. [ ] `npm run env:check` passes with real production environment variables set via the cPanel
   UI.
6. [ ] Database reachable: cPanel-hosted PostgreSQL or external managed provider confirmed
   working end-to-end from the app's terminal.
7. [ ] `database/migrate.ts status` / `up` (with `CONFIRM_MIGRATION=yes`) / `verify` all run
   successfully against the real target database, with a backup taken beforehand.
8. [ ] App starts and stays running (no crash-loop) after *Restart*.
9. [ ] `/health` returns `200` with no sensitive data.
10. [ ] `/ready` returns `200` when the DB is reachable and `503` (not a crash) when it isn't.
11. [ ] All ten shipped SPA routes (section 8) return `200` on **direct navigation** (not just
    client-side routing) and on a hard browser refresh.
12. [ ] Register → login → authenticated request (`/api/auth/me`) works end-to-end through the
    real Apache/Passenger reverse proxy over HTTPS.
13. [ ] Repeated failed logins are rate-limited (`429`), confirmed against the real deployment,
    not just local tests.
14. [ ] Security headers (from `@fastify/helmet`) are present on real responses served through
    Apache (confirm Apache isn't stripping them).
15. [ ] No secret values appear in any committed file, cPanel File Manager–visible file, or
    server response body/log line.
16. [ ] Source-only update procedure (section 7a) exercised once on staging with a trivial change.
17. [ ] Dependency-changing update procedure (section 7b) exercised once on staging with a trivial
    dependency bump.
18. [ ] Existing WHMCS/PHP functionality on the same hosting account confirmed unaffected by this
    app's presence (no shared-path collisions, no `.htaccess` conflicts).

---

*Last updated alongside Phase 1 of the Node platform rebuild. See the Phase 1 completion report
(commit message / PR description) for the exact commit SHA, files changed, and test results this
document corresponds to.*
