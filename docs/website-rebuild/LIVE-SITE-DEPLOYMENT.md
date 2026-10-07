# Why the live site still shows the old design — and how to deploy the rebuild

**Written:** 2026-10-07
**Subject host:** `https://rent.windelsai.com/`
**Symptom:** the website rebuild (PRs #61–#64) is merged on `main`, but the live host still renders
the pre-rebuild design.

This document records what the live host is actually serving, why the previous two "deploy" attempts
could not have changed it, and the exact procedure that does. Every claim in §1 is a response the
live host returned, not an assumption.

---

## 0. Read this first: there are two separate problems, and only one of them is the design

The stale deployment is problem one. Production also has **no working database connection**, which is
problem two — it predates this rebuild, it is not fixed by uploading the new build, and it blocks the
migration step of the deployment.

Evidence from the live host (2026-10-07), all public reads:

| Probe | Live response | Meaning |
|---|---|---|
| `GET /health` | `{"status":"ok"}` | The process is up. `/health` is deliberately dependency-free. |
| `GET /ready` | `{"status":"error","checks":{"database":"error"}}` (HTTP 503) | The app cannot reach its database. `/ready` only reports whether PostgreSQL is reachable. |
| `GET /api/v1/apps?limit=24` | `{"error":"INTERNAL_ERROR",…}` | A DB-backed public endpoint failing — the deployed build's app catalogue. |
| `GET /api/v1/operating-systems` | `{"error":"INTERNAL_ERROR",…}` | Same. This is also the endpoint the WHMCS theme reads for its catalogue. |

`DEPLOYMENT_SUMMARY.md` describes the shipped `.env` as holding a **placeholder `DATABASE_URL`**.
A syntactically valid placeholder passes the startup validator (so `/health` is green) and then fails
every connection (so `/ready` and every catalogue route are red). That is the most likely cause; the
alternatives are a database that was never created, wrong credentials, or `DATABASE_SSL`/
`DATABASE_SSL_REJECT_UNAUTHORIZED` not matching the provider's requirements (see
`docs/CPANEL_DEPLOYMENT.md` §0.3 and §4).

**Diagnose it on the server in one command:**

```bash
npm run db:doctor          # or: node dist/src/config/db-doctor.js
```

It prints the target it read from `DATABASE_URL` (never the password), names the actual cause in
plain language — DNS failure, nothing listening, firewall/allowlist timeout, TLS trust, wrong
credentials, missing database, permission denied — and gives the specific fix. When the connection
works it reports the migration state, including which pending migrations are under the standing
production quarantine and the exact authorization command. `npm run env:check` cannot do any of this
by design: it validates the *shape* of the environment and never touches the network.

**What this does and does not affect:**

* The **design change does not depend on the database.** Every marketing page renders from the
  compiled bundle; the homepage, the navigation and the 3D visuals issue no database query. The
  rebuilt site will therefore look correct the moment the upload lands — with or without a database.
* **Catalogue, pricing, domain, server and account surfaces do depend on it** and will answer with
  their documented empty/error states until it is fixed. Those states are deliberate (they never
  invent a price), but they are not the finished site.
* **`migrate up` cannot run at all** without a reachable database. Fix the connection first
  (§3.3–§3.4), then migrate.

`scripts/verify-live-site.py` reports this as a `WARN`, not a `FAIL`: it is not part of the "is the
rebuild deployed?" verdict, but it is not allowed to pass silently either.

### 0.1 The Tools Center in each of the three states

The tool catalogue is compiled into the app (`src/tools/catalog.ts`); only the operator settings
layered on top of it — enable/disable, maintenance windows, per-provider availability, usage
history — come from the database. That is why a database outage must not be reported as "the tools
are gone". The page looks like this:

| State | `/api/tools/catalog` | What the page shows |
|---|---|---|
| **Old build, live today** | the API path is answered with the SPA's `index.html` | *"Tools are temporarily unavailable. Unexpected token '<' …"* — the request never reached the API. **Fixed only by uploading the rebuild.** |
| **Rebuild uploaded, database still down** | `200` with `"degraded": true` and every tool `SERVICE_UNAVAILABLE` | the full catalogue, one warning notice naming the cause and the fix, and a *Try again* button. Running a tool answers `503` with that same reason. |
| **Rebuild uploaded, database fixed** | `200`, tools `ACTIVE` | the normal page, with usage panels populated. |

The middle row is the one to expect immediately after the upload if §0's database problem is still
unresolved: the tools are listed and the reason is stated, which is the honest answer, not a
dead end. Nothing above requires a migration to have run.

`scripts/verify-live-site.py` checks this directly. `tool-catalogue-answers` fails if
`GET /api/tools/catalog` comes back as HTML rather than JSON — that is the parser-error state — and
warns, without changing the deployment verdict, when it comes back as a degraded JSON catalogue
because the database is still down.

### 0.2 The tool pages are served by two different deployments

This one domain answers tool URLs from two applications, and no single upload fixes both. Probed
2026-10-07:

| URL | What answered | Fixed by |
|---|---|---|
| `/tools` | the Node platform application (React — the page contains "Search tools" / "No tool matches …", strings that exist only in `frontend/src/pages/ToolsCenterPage.tsx`) | `release/cloudhost247-cpanel-<sha>.zip` |
| `/tools/dns-lookup`, `/tools/<slug>` | the PHP/WHMCS theme (`tools/index.php` → `tools/lib/View.php`, `templates/cloudhost247/js/tools.js`) | `cloudhost247-node/release/cloudhost247-tools-only-<sha>.zip` |
| `/tools/api/tools/catalog` (any unknown path under `/tools/`) | the PHP shell, which answers **HTTP 200 with an HTML page** — "Tool not found" | nothing to fix; this is the response a wrong API base produces, and it is why a JSON parse can fail |
| `/api/tools/catalog`, `/api/v1/navigation` | the Node platform application (JSON) | same package as `/tools` |
| `/assets/cloudhost247-tools/tools.js` | 404 — the shared bundle is not deployed on this host | nothing (it is not served here) |

Two consequences worth remembering:

* **Uploading the Node package does not change `/tools/<slug>`.** Those pages never touch `dist/`
  or `public/`. They read `templates/cloudhost247/**`, `tools/**` and `assets/cloudhost247-tools/**`,
  which are a separate upload (`bash scripts/package-tools-only.sh`).
* **A 200 HTML body is the signature to look for.** The pre-fix bundles ran
  `await response.json()` unguarded, so any HTML answer — this PHP shell, a login redirect, a
  web-server error page — surfaced to the visitor as
  `Unexpected token '<', "<!doctype "... is not valid JSON`. That is a parser complaint about a
  document that was never the API, which is why the message was the same on every tool page.

## 1. What the live host is actually running

The live host is the **Node/TypeScript platform** (`cloudhost247-node/`), not the WHMCS/PHP site.
That part was already established in `GLOBAL-AUDIT.md` §1; it is repeated here because it is the
whole reason the earlier fixes missed.

But the Node platform it is running is the **2026-10-04 build**, i.e. the code as it stood *before*
the website rebuild. Evidence:

| Probe | Live response (2026-10-07) | What it means |
|---|---|---|
| `GET /health` | `{"status":"ok"}` | The Node app is up and answering — this is not a stalled or dead deployment. |
| `GET /api/v1/navigation` | `{"error":"NOT_FOUND"}` | The registry-driven navigation API does not exist on the deployed server. It is registered by `src/routes/navigation.ts`, added in the rebuild, and is absent from the old package's compiled `dist/`. |
| `GET /sitemap.xml` | SPA "Page not found" page | The server-rendered sitemap added by `src/routes/seo.ts` is not deployed. |
| `GET /robots.txt` | Byte-identical to `public/robots.txt` **inside the old package** (`release/cloudhost247-cpanel-b7a2af3.zip`), including its "no absolute domain/sitemap URL is hardcoded here" comment | The deployed `public/` tree is the old build's `public/` tree. The rebuilt server generates `robots.txt` with a `Sitemap:` line instead. |
| `GET /media/cloudhost247/brand/icon-mark.svg` | 404 | The rebuilt site's `/media/` tree (illustrations, 3D visuals, brand marks — 181 assets) **was never uploaded**. Only the old package's handful of asset folders exist on disk. |
| `GET /hosting` | Renders *"Not yet built on this platform — see the current CloudHost247 site or contact us for details."* | That string exists in the pre-rebuild `HostingPage` bundle (`assets/HostingPage-CME9CCwy.js` in the old package) and was **deleted** by the rebuild. |
| `GET /` | Hero reads "Cloud infrastructure built for your next idea" / "Fast provisioning", "Straightforward billing", "Support around the clock" | Those strings are in the old package's `assets/HomePage-D4kP70On.js`. The rebuilt homepage renders different copy and a different hero. |
| `GET /` (script tag) | `/assets/index-Ti2UwGlH.js` (per the old package's shell) | The rebuilt bundle is content-hashed under a different name — it changes on every build (`assets/index-DWNaWZa-.js` for `fc9d81a`, to pick one example), and the verifier always reads the expected name from the checkout it is run against. Vite content-hashes filenames, so these can only match if the deployed file is the old one. A live `/assets/index-Ti2UwGlH.js` returning 200 is the stale-copy signature. |

**Conclusion:** the files on the server are the October 4 package. No part of PRs #61–#64 has ever
reached that host. The design did not change because the deployed build did not change.

## 2. Why the two previous attempts could not have worked

1. **The rebuild changed source, not the deployed build.** PRs #61–#63 edited
   `cloudhost247-node/frontend/src/**`, `shared/site/**` and the generator. The live host serves
   *compiled* output (`cloudhost247-node/public/` + `dist/`). Editing TypeScript changes nothing on
   a server until it is rebuilt and the built files are uploaded over the old ones. Nothing was.
2. **PR #64 ("force cache invalidation") bumped the wrong surface.** Its entire diff was
   `?v=20261006` → `?v=20261007` in `templates/cloudhost247/*.tpl` and `tools/lib/View.php`. Those
   are **WHMCS/PHP theme** files. The live host is the Node application: it never reads a `.tpl`
   under `templates/`, and the string `20261006` does not appear anywhere in the SPA bundle. Even a
   perfect cache purge of those URLs could not change what `rent.windelsai.com` renders. The
   diagnosis ("browsers/CDN kept old assets") was wrong — nothing new had ever been deployed to be
   cached in the first place.
3. **The repository contained a pre-rebuild package, and its documentation pointed at packages that
   do not exist.** `cloudhost247-node/release/cloudhost247-cpanel-b7a2af3.zip` was committed (an
   exception to the repo's own git-ignore rule for `release/`) and its `public/index.html` is the
   pre-rebuild shell. Meanwhile `DEPLOYMENT_GUIDE.md`, `DEPLOYMENT_SUMMARY.md` and `QUICK_START.txt`
   told the operator to upload `release/cloudhost247-cpanel-b54b047.zip`, which has never existed in
   this repository. Uploading the file the docs named, or the file the repo held, reproduces the old
   site exactly. That artifact has been removed by this change.

## 3. Deploying the rebuild (the procedure that works)

The live site is a cPanel "Setup Node.js App" (Passenger) application. Updating it is a file upload
plus a restart — **not** a WHMCS theme change, and **not** an update to the PHP site.

### 3.1 Build the package (on a machine with Node 22+, not on the shared host)

```bash
cd cloudhost247-node
npm ci
bash scripts/package-cpanel.sh     # -> release/cloudhost247-cpanel-<sha>.zip
```

A pre-built package for checkout `283b2f0` was produced while writing this document:

* `cloudhost247-node/release/cloudhost247-cpanel-283b2f0.zip` (6.7 MB, 1,458 files)
* contains `dist/` (398 compiled server files), `public/` (SPA bundle `index-Dnn-r-Du.js`,
  181 media assets including 20 3D JPEGs), `database/migrations/` (82 files), `manifests/`,
  `server.js`, `package.json`, `package-lock.json`, `.env.example`
* contains no `.env`, no credentials and no `node_modules`

`release/` is git-ignored by design; the artifact stays a local build output. Regenerate it at any
time with the command above.

**Verify the package before uploading it** — a package is identified by the bytes inside it, not by
its filename or its date:

```bash
bash scripts/verify-cpanel-package.sh            # newest package in release/
# or: bash scripts/verify-cpanel-package.sh release/cloudhost247-cpanel-<sha>.zip
```

It opens the archive and fails loudly on the pre-rebuild shell
(`the package is PRE-REBUILD (its shell reads "CloudHost247 — Cloud hosting, built for your next
idea") — do not upload it`), on a shell whose entry bundle is missing, on any bundle still carrying
the deleted `Not yet built on this platform` copy, on a missing media tree, on fewer migrations than
the source tree, and — the check that catches a package which is a *rebuild* but an **older** one —
on any file under `public/` or `dist/` that differs from the checkout you run it in
(`the package was built from different source (run bash scripts/package-cpanel.sh again)`). That last
one matters: a package one commit behind passes every "is this a rebuild?" check, which is exactly
how a fix can be tested, verified and then not deployed.
`scripts/package-cpanel.sh` runs the verifier automatically against its own output, so a fresh build
cannot hand you a stale archive silently.

**Does the tools-fix-only archive cover the tool pages?** Partly, and it is worth being exact about
which part. `bash scripts/package-tools-only.sh` (writes `cloudhost247-node/release/cloudhost247-tools-only-<sha>.zip`) packages the five files that the PHP/WHMCS tool
pages load (`templates/cloudhost247/js/tools.js` with the JSON guard, the theme template and
`tools/lib/View.php` that reference it with a new `?v=`, and the shared bundles). It fixes
`/tools/<slug>`. It does **not** fix `/tools`, the homepage or the catalogue — those are the Node
application, and only the full cPanel package changes them. See §0.2.

**No local Node?** The same build runs in GitHub: **Actions → "Build deployment package" → Run
workflow**. It builds from the selected commit, verifies the package with the same script, and
publishes `cloudhost247-cpanel-package` as a downloadable artifact with its SHA-256 in the run
summary. Download that artifact and upload *those* bytes.

### 3.2 Upload it

In cPanel → **File Manager**:

1. Upload the zip into the application root's parent and **Extract** it.
2. Copy the contents of `cloudhost247-cpanel-<sha>/` **over** the application root, overwriting
   `dist/`, `public/`, `manifests/`, `database/migrations/`, `server.js`, `package.json` and
   `package-lock.json`.
3. **Never overwrite or delete `.env`** — it holds `DATABASE_URL`, `JWT_SECRET` and
   `CREDENTIAL_ENCRYPTION_KEY`. The package does not contain one, so a plain extract-and-overwrite
   is safe. If a delete-then-upload step is used instead of overwrite, do not delete `.env`, and do
   not delete `node_modules` unless you intend to reinstall it (step 3.3).

### 3.3 Install runtime dependencies only if the lockfile changed

The package is pre-built; **do not run `npm run build` on the shared host** (CloudLinux LVE memory
limits routinely kill the TypeScript/Vite build). `package.json` added optional integrations in this
release, so run the install once after the upload — from the app's virtual-environment terminal, or
the **Run NPM Install** button on the application page:

```bash
npm ci --omit=dev
```

### 3.4 Fix the database, then apply the 12 new migrations

**First: nothing in this step can run until the database connection works** (§0). Run
`npm run db:doctor` — it names the cause and the fix; `GET /ready` returning
`{"status":"ok","checks":{"database":"ok"}}` is the confirmation that it is resolved. Typical fixes,
in order of likelihood: replace the placeholder `DATABASE_URL` in `.env` with the real connection
string from the hosting provider (cPanel → *PostgreSQL Databases*); confirm the database and user
actually exist; set `DATABASE_SSL` and, only for providers whose certificate cannot be validated,
`DATABASE_SSL_REJECT_UNAUTHORIZED` (`docs/CPANEL_DEPLOYMENT.md` §4). Preserve
`CREDENTIAL_ENCRYPTION_KEY` when editing `.env`, and **Restart** the application after changing it —
Passenger does not re-read the environment by itself.

Then: the deployed build knows about 70 migrations; this build ships **82** (`0071`–`0082`: service
cart items/platform plans, Website Builder, AI Website Builder, Online Store, Experts, Marketing
Services, Logo Maker, Unified Inbox, subscription extension, multi-domain-line orders, inbox
delivery status, digital delivery records).

```bash
node dist/database/migrate.js status     # read-only: shows applied / pending / quarantined
node dist/database/migrate.js up
```

Back up the database first. Migrations `0023`, `0024`, `0025` and `0041` remain quarantined in
production, so what `up` does depends on the state of the database you point it at. All three
outcomes below were reproduced against a real Postgres engine (embedded) before writing them down:

| Database state | What production `migrate up` does |
|---|---|
| **Already at 0070** (the October 4 build migrated it) | Applies exactly the 12 new migrations, `0071`–`0082`. No authorization needed. |
| **Fresh / empty** (no tables, or a database that was never migrated) | **Refuses and applies nothing.** Prints `Refusing to migrate production: 0041 … is quarantined … but pending migration(s) 0042, 0043, 0047, … depend on it. Nothing was applied.` This is deliberate fail-closed behaviour, not a fault. |
| **Fresh, with the owner's per-run authorization** | Applies all 82 migrations, `0001`–`0082`. |

Because production's database is currently unreachable (§0), a repaired connection may well be an
**empty** database — in which case the second row is what you will see. The authorization is a
deliberate owner decision, per run, exactly as `docs/CPANEL_DEPLOYMENT.md` §0a requires:

```bash
CONFIRM_MIGRATION=yes AUTHORIZED_MIGRATIONS=0023,0024,0025,0041 node dist/database/migrate.js up
```

Read the `status` output before choosing: it marks each migration applied / pending / quarantined, so
there is no need to guess which row of the table above applies to you.

The public marketing pages, the navigation, the 3D visuals and the legal/documentation pages are
served from the built bundle and do **not** depend on these migrations — the visual change appears as
soon as step 3.5 is done. The migrations enable the newer platform features that call the database.

### 3.5 Restart, then clear anything in front of the app

1. cPanel → **Setup Node.js App** → select the application → **Restart**. Passenger serves the
   process from memory; without a restart the old `dist/` can keep answering.
2. If Cloudflare or another CDN/proxy is in front of the host, purge its cache. The SPA's entry
   chunk is content-hashed (`index-<hash>.js`), so a stale `index.html` is the only file that can
   pin an old build — purge at least `/` and `/index.html`.
3. Hard-reload the browser once (Ctrl/Cmd+Shift+R). The app registers no service worker, so nothing
   client-side can outlive a purge.

### 3.6 Prove it took effect

```bash
python3 scripts/verify-live-site.py --base https://rent.windelsai.com/
```

Read-only, no authentication, exit code 0 only when every deployment check passes. It fails with
`live <title> = 'CloudHost247 — Cloud hosting, built for your next idea'  <-- PRE-REBUILD BUILD IS
DEPLOYED` while the old build is still being served, and compares the live entry bundle filename
against the local build so "did my upload land?" is answered by a filename, not an impression.

The database is reported separately as `WARN database-reachable`, so "the rebuild is live but the
database still needs fixing" is a distinct, honest result rather than a pass or a failure — exactly
the state production is in today (§0).

The same check runs from GitHub without any local tooling: **Actions → "Verify live deployment" →
Run workflow**.

Before uploading, the same script can confirm the local package is self-consistent
(`--base` pointed at nothing is not required; use `--local cloudhost247-node/public` when comparing
against a live base).

### 3.7 If the site still does not change after 3.1–3.6

Work down this list; each item produces the exact symptom above.

1. **Wrong application root.** The files were uploaded to a directory that is not the one cPanel's
   Node app points at. Confirm the path on the *Setup Node.js App* page and re-upload there.
2. **Apache is serving a static copy of the SPA.** If `public_html` (or the domain's document root)
   holds its own copy of the old `index.html` + `assets/`, Apache answers those URLs without ever
   reaching Node. Check with `GET /assets/index-Ti2UwGlH.js`: if that file still returns 200 after
   the upload, a stale copy exists in the document root and must be replaced or rewritten away.
3. **The upload landed but the process did not restart** — step 3.5.1.
4. **A CDN is still serving the old shell** — step 3.5.2. Note that only `/` and `/index.html` can
   be stale in a way that matters; the hashed asset files cannot collide.
5. **Two applications, one domain.** An older Node app still bound to the same `Application URL`
   will keep answering. Remove or repoint the stale one.

## 4. What this does *not* claim

* No real cPanel/Passenger run has been performed by the agent that wrote this document: the sandbox
  it runs in cannot reach `rent.windelsai.com` over TLS at all. §1's evidence comes from public reads
  of the live host; §3 is the repository's documented procedure, and `docs/CPANEL_DEPLOYMENT.md`
  still lists its own unclosed staging gate.
* The package was built and its contents verified here (file counts, media assets, migrations,
  bundle hash, no secrets), and the built app was exercised as static output. That is not a cPanel
  verification, and it is not a substitute for running `verify-live-site.py` against the host after
  the upload.
* Nothing in this document changes the WHMCS/PHP website. That surface has its own deployment and
  its own theme; the `?v=` asset versions from PR #64 remain correct for it, they simply have nothing
  to do with `rent.windelsai.com`.

## 5. Rollback

Re-upload the previous `dist/` and `public/` trees (or restore the app root from the cPanel backup
taken before the upload), then Restart. Migrations `0071`–`0082` are additive; leaving them applied
does not break the older build, which never reads those tables.
