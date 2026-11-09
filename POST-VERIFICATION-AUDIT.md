# CloudHost247 — Post-Verification Independent Audit (2026-11-09)

Branch: `arena/fe9b2088-cloudhost247` · Remote: `origin/arena/fe9b2088-cloudhost247`
Scope: independent re-verification after the repository-wide audit
(recorded in `VERIFICATION-REPORT-2026-11-09.md`).
Every claim below includes the command used; all were executed on this branch on 2026-11-09.

---

## 1. Commit verification — PASS

| Check | Command | Result |
|---|---|---|
| All four commits on remote | `git fetch origin arena/fe9b2088-cloudhost247 && git rev-parse ...` | local `c578ff2ff8b89c8c855be2edf6b80faab7f0ef58` == remote identical |
| Parent-child history | `git log --oneline` | linear: `c0582183` → `cca9e458` → `bae36080` → `c578ff2f` on top of baseline `012106de` (PR #109 merge) |
| No uncommitted changes | `git status --short` | clean (only untracked local runtime dirs, all git-ignored: `.env`, `.dev-db-pg/`, `.cache/`, `node_modules/`) |
| Changed files match report §6 | `git show --stat` per commit | exact match: c0582183 = 7 files (link fix + published doc + generated surfaces), cca9e458 = 2 inventory files (4 lines), bae36080 = manifest + BRANDING-COMPATIBILITY (26 lines), c578ff2f = verification report only |
| Report matches repository state | this audit, §2 below | confirmed (see each check) |

Full-history note: the clone was deepened (`git fetch --unshallow`, 731 commits) to trace
the vendor-file lineage; the findings below use that history.

## 2. Independent regression audit — PASS

### R-1 · F-1 repair (Google Ads documentation link) — verified live, both stack halves
- SPA route shell: `curl http://localhost:5173/docs/integrations-google-ads` → **HTTP 200**.
- Document body: `curl http://localhost:5173/docs/integrations-google-ads.md` → **HTTP 200**,
  real content (`# Google Ads integration`, 83 lines).
- Production half: `npm run build` output contains `public/docs/integrations-google-ads.md`
  (14,071 bytes); the `serveFrontend:true` fastify-static path is covered by
  `tool-page-status.test.ts` (passes in the 2,901-test suite).
- The dev API intentionally runs `buildApp(env, { serveFrontend: false })`
  (`scripts/dev-server.ts:71`), so `:3000` 404s for SPA paths in dev are **by design**;
  the dev SPA is served by Vite on :5173. Not a defect.
- Registry state: `docs.generated.json` contains slug `integrations-google-ads`;
  link-integrity test passes (4/4).

### R-2 · F-2 repair (page inventory) — zero-diff regeneration
- `python3 scripts/audit-navigation-inventory.py` re-run → `git diff --exit-code` on
  `page-inventory.json`/`page-inventory.csv` → **no diff**. Committed inventory matches
  the live registry exactly.

### R-3 · F-3 repair (vendor integrity manifest) — whole-tree byte check
- `sha256sum --check --strict --quiet docs/independent-rebuild/original-file-manifest.sha256`
  → **exit 0** (every listed path, not only the two re-cut files).
- Lineage proof (full history): `git diff 283cf079..HEAD` on the two templates shows only
  the consent-aware Google Ads/TikTok changes recorded in the manifest header.

### R-4 · Regression sweep after all repairs
- Full release-candidate gate re-run after all three fixes: **exit 0**, rendered-site audit
  executed (Smarty 4.5.6 fetched, SHA-256-verified).
- Full vitest re-run after all fixes: **232 files / 2,901 tests, all pass** (baseline had
  1 failure — F-1 — now green).
- No test was weakened: the only test-visible change is the new legitimate route/doc.

### R-5 · Honest-empty-states spot check (live traffic observed in dev server logs)
- `GET /api/v1/catalog/products/web-hosting/plans` → 404 in dev. Investigated: endpoint
  exists (`catalog-public.ts:66`); the dev seed deliberately contains only
  `dev-example-*` fixtures (marked "not real prices"), no `web-hosting` product.
  **This is the designed honest empty state, not a broken endpoint** — the directive's
  rule "never fabricate prices" is enforced by data scarcity, and production catalogs
  are operator-seeded via the admin API.

## 3. Blocked-verification completion plans (Step 3)

### B-1 · Playwright browser e2e (19 specs, incl. browser link-integrity half)
- **Blocker:** no Chromium binary on this host; Playwright CDN unreachable from the sandbox.
- **Plan:** on a host with network access to the Playwright CDN (or an internal mirror):
  `npx playwright install --with-deps chromium`, then `npm run e2e` against the dev stack.
  Evidence expected: spec results + rendered screenshots; the repo also ships
  `scripts/capture-rendered-pages.mjs`, `check-header-layout.mjs`, `check-chrome-benchmark.mjs`
  for pixel/a11y evidence. Runtime now: none required beyond the dev stack.

### B-2 · Licensed WHMCS staging tests
- **Blocker:** WHMCS core (`init.php`, `vendor/`, license, DB) is absent by design.
- **Plan:** follow `docs/DEPLOYMENT-GUIDE.md` staging-first procedure on a licensed install;
  activate each addon/provisioning module; run checkout, invoice, SSO hand-off, and the
  provisioning smoke tests; capture results per `docs/staging` evidence conventions.
  Gate: none of this changes source — it certifies runtime behavior.

### B-3 · Production-like PostgreSQL financial probes
- **Blocker:** `npm run verify:financial` / `verify:authorization` CLIs target a real
  Postgres (default `127.0.0.1:55432`) by design; no TCP Postgres exists here.
- **Already done here:** the identical check functions ran inside
  `financial-invariant-sweep.test.ts` / `payment-authorization-matrix.test.ts` against the
  embedded Postgres (PGlite) — adversarial non-transactional writes, whole-database sweeps,
  append-only ledger invariants, "no unauthorized call can mark an order paid".
- **Plan:** on staging, provision Postgres, `DATABASE_URL=... npm run verify:financial`
  (and `verify:authorization`) — must report zero invariant violations on the real engine.

### B-4 · Payment/provider sandbox certification
- **Blocker:** requires owner credentials/authorization; restricted by the operating rules.
- **Plan:** use provider sandboxes only (Stripe/PayPal/Paystack test keys, Hetzner/DO/Vultr
  sandbox projects): configure webhook secrets → verify signature acceptance/rejection →
  run a sandbox order → confirm ledger entries and idempotency. Providers fail closed
  today (verified in tests: undeclared/unconfigured adapters refuse rather than pretend).

### B-5 · Quarantined migrations 0023 / 0024 / 0025 / 0041
- **Blocker:** production-quarantined pending explicit owner authorization per
  `docs/NODE_PLATFORM_STATUS.md`; `migration-quarantine.test.ts` enforces the list.
- **Plan:** owner reviews each migration's purpose and blast radius on a staging clone;
  authorize individually; apply with the migration runner's atomicity; verify
  `npm run migrate:verify`. No source change required — authorization only.

No authorization gate was bypassed anywhere in this audit.

## 4. Verdict

All four repair commits are on the remote with clean history; the fixes hold under live
re-verification; the full automated evidence base (release gate, 2,901 tests, both PHP
lint legs, Python suites, production build, rendered-site audit, npm audit) is green
**after** the repairs, with zero regressions detected. Production certification remains
gated on B-1..B-5, which need infrastructure/credentials this sandbox cannot supply.
