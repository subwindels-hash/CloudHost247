# Staging Environment Requirements & Unverifiable Features

**Date:** 2026-11-07 · **Branch:** `arena/1b329121-cloudhost247` · **Purpose:** precise, approvable requirements for a **licensed WHMCS + cPanel staging environment**
**Instruction:** "Continue developing against the existing architecture, but do not claim full production compatibility without a licensed WHMCS and cPanel staging environment. Document every feature that cannot be verified without those environments. Prepare a precise staging-environment requirement list for approval."

**No production compatibility is claimed in this document.** No deployment has occurred.

---

## 1. What the current sandbox actually provides (baseline)

| Provided | Not provided |
| --- | --- |
| Full source tree, 83 SQL migrations, 50 Fastify route modules, 131 SPA pages, 23 WHMCS addons, 14 server modules, 84 root PHP pages | Licensed WHMCS 8.x core and its database |
| `scripts/php-wasm/php` → PHP 8.2.33 WASM (syntax lint only) | Native PHP 7.4 / 8.2 with ionCube Loader |
| PGlite in-memory Postgres for isolated tests + live preview on :3000 | cPanel account, "Setup Node.js App" (Passenger), SSH/Terminal |
| Real headless Chromium (npm `@sparticuz/chromium` + `playwright-core`) → rendered screenshots | A WHMCS-rendered page, Smarty templates compiled by WHMCS |
| Vitest/`node:test`/Python suites | Real PostgreSQL on cPanel, cron daemon, mail transport |
| No provider credentials, no gateway, no live webhook | Real SMTP/M365/Google, registrar, CA, infrastructure provider |

Consequence: **PHP syntax clean ≠ WHMCS runtime verified**; **generator parity ≠ rendered WHMCS page parity**; **SPA screenshots ≠ PHP page screenshots**.

---

## 2. Precise staging-environment requirement list (for approval)

### 2.1 WHMCS / PHP staging host

| # | Requirement | Exact value / evidence needed |
| --- | --- | --- |
| W1 | **Licensed WHMCS 8.x** installed in a staging-only directory (never `public_html` root of the live site) with a valid staging licence key | licence confirmation + `version` from WHMCS admin; per `docs/INSTALLATION-GUIDE.md` §1–3 |
| W2 | PHP **7.4 and 8.2** runtimes available for the compatibility matrix, with **ionCube Loader** matching each | `php -v`, `php -m` for both; `ext-intl` must be present (the WASM shim lacks it) |
| W3 | PHP extensions: `curl`, `json`, `pdo`, `pdo_mysql` or `pdo_pgsql`, `openssl`, `mbstring`, `intl`, `zip`, `gd`, `bcmath`, `fileinfo` | `php -m` output committed as evidence |
| W4 | A **disposable** MySQL/MariaDB database + least-privilege user for the WHMCS staging install | connection details supplied out-of-band; no production data, no production credentials |
| W5 | WHMCS hooks/addons activated **staging-only**: `cloudhost247_theme`, `cloudhost247_integrations`, `cloudhost247_currency`, `cloudhost247_builder`, `cloudhost247_marketing`, `cloudhost247_passkey`, `cloudhost247_ovh` etc., per `docs/INSTALLATION-GUIDE.md` §4 | addon activation list + hook log |
| W6 | Generated theme assets installed via `scripts/site/generate.mjs`: `templates/cloudhost247/resources/site.json`, `templates/cloudhost247/css/design-system.css`, `assets/images/cloudhost247/**`, `lang/overrides/**` | file hashes before/after generator |
| W7 | **Staging-only** provider credentials in the encrypted vault (`CH247_INTEGRATIONS_KEY`, `CH247_PLATFORM_ENVIRONMENT=staging`); **no live gateway, no live webhook, no real customer transaction** | vault config sample with redacted values |
| W8 | Inbound mail sink / catch-all dev mailbox (no real recipients) and a staging SMTP relay | delivery log; unsubscribe/DSN test inbox |
| W9 | Cron access to schedule `crons/cloudhost247_marketing.php`, `crons/cloudhost247_ovh.php`, `crons/getServer.php`, `crons/priceSync.php` **one-shot only** | cron entry + run log |
| W10 | Staging domain + valid TLS certificate; no production hostname | URL + certificate details |
| W11 | Backup + proven restore of the staging DB and files before any test (`docs/DEPLOYMENT-GUIDE.md` §5) | restore drill log |
| W12 | Rollback plan and stop conditions per `docs/DEPLOYMENT-GUIDE.md` §2/§13 | written plan |

### 2.2 cPanel / Node staging host

| # | Requirement | Exact value / evidence needed |
| --- | --- | --- |
| C1 | cPanel account with **"Setup Node.js App" (Application Manager / Passenger)** | screenshot of the cPanel Software section (`docs/CPANEL_DEPLOYMENT.md` §0.1) |
| C2 | Node.js Selector offering **Node 22 LTS** (canonical stack declares `v22.x`; `platform/` requires `>=22.20 <25`) | Node Selector version list |
| C3 | SSH or cPanel **Terminal** access | connection confirmation |
| C4 | Exact application root, e.g. `/home/<cpaneluser>/cloudhost247` — **not** `public_html` | path record |
| C5 | PostgreSQL: cPanel "PostgreSQL Databases" or an external **disposable** Postgres; dedicated least-privilege DB user; `DATABASE_URL` | `docs/CPANEL_DEPLOYMENT.md` §4 |
| C6 | Environment variables: `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `NODE_ENV=staging`, `APP_URL`, `CH247_INTEGRATIONS_KEY`, `CH247_PLATFORM_ENVIRONMENT=staging`; **no live payment keys** | `npm run env:check` output |
| C7 | `npm ci` from the lockfile, `npm run build:server`, `npm run build:frontend`, restart via Setup Node.js App | build logs |
| C8 | Migration procedure **explicit and controlled**: `node dist/database/migrate.js status` → `verify` → `CONFIRM_MIGRATION=yes ... up`. **Quarantined 0023/0024/0025/0041 stay quarantined** unless separately authorised | before/after `status` + `verify` |
| C9 | `/health`, `/ready`, `/api/v1/public/status`, catalog, tools and auth smoke tests | curl/HTTP logs |
| C10 | Cron one-shot for the worker (`node dist/src/worker*.js`) — no overlapping background timer | cron entry + worker log |
| C11 | No production data, no production credentials, no live gateway/webhook, no real customer transaction | written attestation |

### 2.3 Shared / cross-stack

| # | Requirement |
| --- | --- |
| S1 | Same `shared/site/registry.json` + `design-system.css` projected into **both** PHP theme and Node SPA; file hashes recorded before/after `node scripts/site/generate.mjs` |
| S2 | Browser matrix: Chromium desktop 1440 / tablet 834 / mobile 390 for **both** the SPA and at least 5 WHMCS-rendered pages; screenshots saved to `docs/evidence/screenshots/` |
| S3 | Isolated test data only. Demo/preview catalogue rows must be labelled; no real price presented as live |
| S4 | Approval boundary: staging activation is **not** production deployment. A separate explicit approval is required for any production change. |

---

## 3. Every feature that cannot be verified without these environments

Derived from `docs/feature-parity-register.csv`; these are **not** claimed complete. `Blocked by external provider` here means specifically the licensed WHMCS/cPanel staging dependency (as distinct from missing third-party provider credentials, which is covered in `docs/PROVIDER-COMPARISON.md`).

| Register IDs | Capability | Why it needs WHMCS/cPanel staging | What WAS verified statically |
| --- | --- | --- | --- |
| `A16` | WHMCS + provisioning workflows keep working | Requires licensed WHMCS core + DB; WASM PHP only proves syntax | 838/838 PHP syntax targets clean on PHP 8.2 WASM |
| `AR03` | PHP/WHMCS ↔ React/Node consistency | Requires both rendered applications side by side | generator writes both `registry.generated.ts` and `site.json`; 221 links / 0 broken |
| `AR06` | cPanel deployment constraints | `docs/CPANEL_DEPLOYMENT.md` 18-point checklist is entirely unchecked | checklist read and reproduced as C1–C11 above |
| `W01`–`W18` | PHP/WHMCS public pages rendering | Generator output is data, not a rendered WHMCS page | SPA rendered in real Chromium (18 screenshots captured); PHP pages not rendered |
| `D06`–`D13` | File manager, FTP/SFTP, DB, PHP version, cron, email accounts, forwarders, DKIM/SPF/DMARC | These are cPanel functions to **integrate**, not rebuild; need WHM UAPI + cPanel UAPI on a real host | capability flags catalogued; `base.ts` honesty hazard identified |
| `D24` | cPanel reuse rather than rebuild | Needs a live WHM/cPanel API call | `whm`/`cpanel` vault catalogue entries + health-check definitions exist |
| `A02` | Managed WordPress / WP Toolkit | cPanel WordPress Toolkit integration | none (Not implemented) |
| `A09`/`A10`/`G01`–`G06` | Email hosting / business email / webmail / SMTP / email auth | M365/Google/cPanel SMTP + mail sink + staging cPanel | PHP module source + SMTP client code |
| `G07`–`G13` | WHMCS marketing: lists, campaigns, scheduling, analytics, DSN/unsubscribe | Needs WHMCS addon activation, cron, SMTP sink, DSN ingestion | 12-session module implementation audited; PHP behavioural suites **not** run |
| `G15`/`G16` | Consent + anti-abuse | Needs a real (sink) mail flow to prove suppression/unsubscribe | source-level controls present |
| `H04`, `L01`–`L12` | Payment gateways, cart, invoices, ledger, refunds, renewals, tax | WHMCS billing + cPanel Node DB + **financial freeze** | Node billing Vitest suites + financial-invariant sweep; no live gateway |
| `I01`–`I12` | Domain registration/transfer/renewal/pricing/locking/contacts | Registrar API creds + WHMCS registrar module activation | fail-closed adapters + `domain-services-api.test.ts` |
| `B02`, `B08`, `B10` | WHMCS visual builder: drag editor, custom CSS/HTML/JS validation, expiring preview token | WHMCS addon + Smarty templates + browser | `tests/builder/{fakes.php,run.php,test_static.py}` not run |
| `F09`/`F10` | TOTP / WebAuthn passkeys on the PHP side | Real origin/RP ID, WHMCS session, browser authenticator | Node-side Vitest suites passed; `platform/MIGRATION.md` records no real browser/hardware ceremony |
| `K03`/`K04`/`K06`/`K07` | Live chat, searchable KB, status/incident pages in PHP | WHMCS rendering + status feed | SPA `/status` + `/api/v1/public/status` verified |
| `GX09`/`GX10` | Currency consistency across PHP invoices and dashboard | WHMCS currency addon + invoice templates | `docs/MULTI-CURRENCY-ARCHITECTURE.md` core + 14 unit tests |
| `W18` | Accessibility/SEO on **rendered PHP** pages | WHMCS-rendered HTML | `scripts/check-accessibility-contract.py` static contract; SPA screenshots |
| `E03`, `E09`, `E10` | Real provider provisioning/snapshots/backups | cPanel Node app + server-agent + provider account | fail-closed adapters + worker tests |

## 4. Verification plan once staging exists (no production step)

1. `node scripts/site/generate.mjs` → compare PHP theme and SPA generated files byte-for-byte against the canonical registry.
2. `bash scripts/php-lint-targets.sh | xargs -r -P 8 -n1 php -l` on **both PHP 7.4 and 8.2** with ionCube.
3. `python3 -m unittest discover tests` (PHP behavioural suites), `tests/builder/run.php`, marketing 120-message exactly-once soak, repeat-unsubscribe regression.
4. `npm run typecheck && npm run lint && npm run build:server && npm run build:frontend`; sharded full Vitest suite; `platform/` `node --test tests/*.test.js`.
5. `node dist/database/migrate.js status/verify` — **quarantined migrations remain quarantined** unless D2 authorisation is granted.
6. `npm run evidence:screenshots` against the SPA **and** a script capturing 5+ WHMCS-rendered pages at 3 viewports.
7. End-to-end: register → login → MFA/passkey → cart → sandbox checkout (no live gateway) → invoice → provisioning (sandbox provider) → DNS → SSL (ACME staging) → publish → support ticket → refund, with DB assertions and negative permission cases.
8. Produce a per-feature acceptance table with the six allowed statuses, exact files, DB changes, API endpoints, frontend routes, integrations, test results, screenshots and known limitations.

## 5. Approval request

Approve or amend **W1–W12, C1–C11, S1–S4** above. Until approved:
- no claim of full production compatibility;
- all rows in §3 remain `Implemented but not fully verified`, `Blocked by external provider` or `Not implemented`;
- no production deployment, no live gateway, no live webhook, no real transaction.

This request is for a **staging environment only**. It does not request production access, a payment activation, or a change to financial settings.
