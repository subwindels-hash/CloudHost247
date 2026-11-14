# CloudHost247 Node Platform — cPanel app-root deployment notes

This file lives **inside the Node application subtree** so the path printed by `server.js`
(`docs/CPANEL_DEPLOYMENT.md`) resolves inside `<APP_ROOT>` for an operator working only in cPanel
File Manager. Developers working in the Git checkout should use the full authoritative guide at the
repository root: `../../docs/CPANEL_DEPLOYMENT.md` (relative to `cloudhost247-node/docs/`).

> **Real cPanel staging verification is still an open gate.** Everything below is a deployment
> procedure, not a claim that this platform has been certified on a real cPanel/Passenger host.
> See Appendix C of the repository-root guide before describing it as cPanel-ready.

---

## The error you are probably looking for

If `<APP_ROOT>/stderr.log` repeats:

```
[server.js] Compiled application not found at dist/src/server.js. Run "npm run build" ...
```

then Passenger is restarting in a loop because `<APP_ROOT>/dist/src/server.js` does not exist.
`dist/` is **generated, git-ignored build output** — a fresh `git clone` / source upload never
contains it. `public/` (the built React SPA) is generated too and must be present as well.

`server.js` now tries to recover in this order:

1. **`dist/src/server.js` exists** → start normally.
2. **A complete pre-built package was extracted into a nested folder**
   (e.g. `<APP_ROOT>/cloudhost247-cpanel-<sha>/dist/...`) → start that build with a loud warning.
   Move its *contents* into `<APP_ROOT>` at the next maintenance window.
3. **Sources + TypeScript + Vite are installed** → run a one-time atomic recovery build
   (server into a temp `dist/`, frontend into `public/`) under a lock, then start.
4. **None of the above** → print diagnostics (app root, cwd, Node version, what is missing) and
   exit cleanly instead of a stack trace.

Set `DISABLE_AUTO_BUILD=1` to skip step 3, and `DISABLE_NESTED_BUILD=1` to skip step 2 as well.

---

## Fastest fix: upload the pre-built package (no server-side build)

Do this when the host has no terminal, or when `npm run build` is killed by CloudLinux LVE limits.

1. On a machine with Node.js >= 20.9.0 (laptop or CI), from the repository root:

   ```bash
   cd cloudhost247-node
   npm ci
   bash scripts/package-cpanel.sh
   ```

   Output: `release/cloudhost247-cpanel-<git-sha>.zip`. The zip contains `server.js`, `dist/`,
   `public/`, `database/migrations/`, `manifests/`, `package.json`, `package-lock.json`,
   `.env.example`, `docs/CPANEL_DEPLOYMENT.md` and `DEPLOY.txt`.

2. In cPanel File Manager, upload the zip to your home directory and **Extract** it.

3. **Critical — avoid the nested-folder mistake:** move the **CONTENTS** of
   `cloudhost247-cpanel-<sha>/` directly into the application root configured in
   *Setup Node.js App*. After the move, `<APP_ROOT>/server.js`,
   `<APP_ROOT>/dist/src/server.js` and `<APP_ROOT>/public/index.html` must all exist.
   Do **not** leave `<APP_ROOT>/cloudhost247-cpanel-<sha>/server.js`; that is the layout that
   causes this crash-loop. `DEPLOY.txt` inside the zip repeats this instruction.

4. In the app's virtual-environment terminal (or *Run NPM Install*):

   ```bash
   npm ci --omit=dev
   ```

   Production dependencies only — the zip already contains the compiled output.

5. Configure environment variables in *Setup Node.js App* → Environment Variables (see
   `.env.example` for names; never commit real values). Do **not** set `PORT` — Passenger injects it.

6. Click **Restart**, then verify:

   ```bash
   curl https://<your-app-url>/health    # 200
   curl https://<your-app-url>/ready     # 200 when DATABASE_URL is reachable
   ```

---

## If you do have terminal access (source deploy)

From `<APP_ROOT>` in the cPanel virtual-environment terminal:

```bash
npm ci            # full install: TypeScript + Vite are devDependencies
npm run build     # produces dist/ AND public/
npm run env:check
# run migrations per the repository-root guide §6 (never automatic on startup)
```

Then **Restart**. Do not use `npm ci --omit=dev` before `npm run build`, and do not use
`npm run dev` / Vite dev server in production.

If you restart before building, `server.js` will attempt the one-time recovery build described
above. That is a safety net, not a substitute for running the build in your terminal where
failures are visible and attributable.

---

## Minimum environment variables

| Variable | Example / note |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://cloudhost247.com` |
| `DATABASE_URL` | `postgresql://user:password@host:5432/database` |
| `DATABASE_SSL` | `true` / `false` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | normally `true` |
| `JWT_SECRET` | >= 32 random chars; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte key for secrets at rest (see `.env.example`) |

`PORT` is supplied by Passenger. Optional recovery toggles: `DISABLE_AUTO_BUILD=1`,
`DISABLE_NESTED_BUILD=1`. After any env change, **Restart**.

---

## Crash-loop checklist

1. Read the newest `[server.js]` diagnostics in `stderr.log` — it prints the exact app root and
   which of `src/`, `tsconfig.json`, TypeScript, Vite, `public/index.html` is missing.
2. Confirm `dist/src/server.js` and `public/index.html` sit **directly** in `<APP_ROOT>`, not one
   folder deeper.
3. Run `npm run env:check` — a missing/malformed secret is the other common first-deploy crash.
4. Confirm `DATABASE_URL` is reachable (`node dist/database/migrate.js status`). `/health` does
   not check the DB; `/ready` does.
5. Only after the above, check Passenger/Apache proxying and application routes.

---

## What must never be uploaded

- No real `.env`, private key, or provider credential in a web-servable directory.
- No `node_modules/` from your laptop (cPanel manages its own virtual environment).
- No WHMCS/PHP tree inside `<APP_ROOT>` — only the `cloudhost247-node/` contents belong here.
