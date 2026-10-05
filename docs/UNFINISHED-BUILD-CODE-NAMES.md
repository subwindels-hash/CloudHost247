# Unfinished build code — name list

**Scope:** every module/build artifact in this repository whose code is *not finished and verified*.
**Compiled:** 2026-10-05, against `HEAD 3ee7e21` on `arena/01a10c4a-cloudhost247`.
**Sources:** `docs/UNFINISHED-MODULES.md` (canonical audit), `platform/MIGRATION.md`, per-file
`deferred` markers, `ADAPTER_PROFILES` in `cloudhost247-node/src/infrastructure/providers/configuration.ts`,
`QUARANTINED_MIGRATIONS` in `cloudhost247-node/database/migrate.ts`, and a zero-byte file scan.

Two things are **not** in the list because they are finished: the twelve-session
`cloudhost247_marketing` build and the OVH addon/server module (source-complete; both are
staging-blocked — see §5).

**Progress log (completing these one by one):**

| # | Module | Status |
|---|---|---|
| 1 | `platform/` payment gateways — Stripe / PayPal / Paystack inbound webhooks + strict settlement receiver | **DONE 2026-10-05** — see §1b. Initiation of a real-provider checkout remains deferred (needs provider egress) and is refused with that reason |
| 2 | `platform/` passkeys / WebAuthn — enrolment, management, sign-in (email-first + usernameless) and the browser ceremony helper | **DONE 2026-10-05 (server + both frontends; not browser-verified)** — see §1b. Attestation formats other than `none` are refused by name; no real browser or hardware authenticator has driven a ceremony in this environment |

---

## 1. `platform/` — the newest build (added 2026-10-05) — largest unfinished surface

41 domains exist and its 450 tests pass, but 15 modules ship **explicit `deferred` markers** for the
live integration side, and the frontend is a fraction of the old one.

### 1a. Modules whose live integration is deferred (code present, egress missing)

| Module | What is deferred |
|---|---|
| `platform/src/lib/provider-adapters.js` | Live egress for **all 12 provider kinds**: `hetzner`, `digitalocean`, `vultr`, `aws` (EC2), `contabo`, `ovh`, `proxmox`, `virtualizor`, `solusvm`, `openstack`, `operator-bridge`, `mock` — AWS SigV4 stated as deferred at the adapter boundary |
| `platform/src/domains/infrastructure.js` | Live provider adapters, image verification, provider reconciliation |
| `platform/src/domains/servers.js` | Hypervisor/provider actions, live console session (issues a token only) |
| `platform/src/domains/provisioning.js` | Provider-side build execution |
| `platform/src/domains/operating-systems.js` | Provider mapping filter |
| `platform/src/domains/monitoring.js` | Agent metric ingestion |
| `platform/src/domains/deployments.js` | CI/CD execution (created deployments only start) |
| `platform/src/domains/app-installations.js` | Paid-order provisioning worker, deployment log streaming |
| `platform/src/domains/services.js` | Provisioning worker |
| `platform/src/domains/marketplace.js`, `marketplace-admin.js` | One-click deploy execution |
| `platform/src/domains/dns.js` | Cloudflare/Route53 provider egress |
| `platform/src/domains/ssl.js` | Certificate issuance integration |
| `platform/src/domains/cloudflare.js`, `admin-cloudflare.js` | Live Cloudflare client, "Test Connection", live purge |
| `platform/src/domains/domain-services.js` | Availability / WHOIS-RDAP / appraisal provider connector |
| `platform/src/domains/admin-domain-services.js` | Registrar transfer refresh poll |
| `platform/src/domains/ai-os.js` | Model adapter — Copilot inference (prompt is recorded, no reply) |
| `platform/src/domains/ai-support.js` | LLM inference (human agents only) |
| `platform/src/domains/tools.js` | Live DNS resolver + live HTTP checker connectors |

### 1b. Named but absent features

- ~~**WebAuthn / passkeys** — schema tables (`webauthn_*`) exist, **no routes** in `platform/`.~~
  **Closed 2026-10-05:** implemented **without** `@simplewebauthn/server` (this platform has no
  runtime dependencies), so the protocol lives in-tree — `platform/src/lib/webauthn/{cbor,cose,
  authenticator-data,verify,options}.js` (strict RFC 8949 decoder, COSE_Key → SPKI, ceremony
  verification for ES256/RS256/PS256/EdDSA) and `platform/src/domains/passkeys.js`
  (`GET /auth/passkeys`, `POST /auth/passkeys/register/options|verify`,
  `PATCH|DELETE /auth/passkeys/:id`, `POST /auth/passkeys/login/options|verify`, legacy
  `/api/auth/*` aliases included). Enrolment and removal need the current password and are refused
  during a support session; challenges are single-use, 5-minute and burned before verification;
  sign-in mints the same session as password login, either email-first or usernameless via a
  discoverable credential (account resolved from the chosen credential, `userHandle` matched).
  The browser ceremony is driven by `platform/public/assets/js/webauthn.js`, shared by the public
  login page and the dashboard's Security page. Evidence: `tests/webauthn.test.js` (84) and
  `tests/webauthn-browser.test.js` (10) on top of a software authenticator that signs real
  assertions against a real HTTP server, plus 11 mutation checks on the refusal rules. **Limits
  stated rather than papered over:** no real browser/hardware authenticator has run a ceremony here
  (Node has no WebAuthn stack, and the sandbox preview cannot host one — the ceremony needs a
  permitted RP origin and the platform refuses framing), so the marshalling is verified by
  round-trip tests and by feeding the helper's output to the real server, not by a device; and
  attestation `fmt !== 'none'` is refused because there is no trust-anchor store.
- **TOTP QR enrolment image** — secret + `otpauth://` URI returned; QR/PNG encoder not written.
- **`platform/scripts/rehash-passwords.js`** — bcrypt → scrypt re-enrolment tool: *not yet implemented*.
- ~~**Payment gateways** — only `sandbox` + `manual` ported; no Stripe / PayPal / Paystack / Blockonomics.~~
  **Closed 2026-10-05 (inbound half, `platform/`):** Stripe, PayPal and Paystack webhooks are now
  implemented in `platform/src/lib/gateways/` + `platform/src/lib/provider-webhook-service.js` —
  per-provider signature verification against the exact raw bytes before any database access,
  canonical event mapping, unique-index event claiming with 60 s lease takeover, zero-trust
  amount/currency/owner/invoice-total invariants, and settlement through the shared
  `applySuccessfulPayment`. 40 tests in `platform/tests/gateways.test.js`; whole suite 357 green.
  Still open, and refused with that reason: **initiating** a real-provider checkout (needs live
  provider egress + PSP credentials), and the Blockonomics (Bitcoin/USDT) gateway used by the WHMCS
  build, which has no `platform/` equivalent at all.
- **SPA dashboard (`platform/spa/`)** — 4 of ~84 pages ported (`CatalogPage`, `DashboardPage`,
  `SecurityPage`, `SupportPage`); the whole admin console, server detail, billing, DNS, Cloudflare,
  marketplace, AI and Tools screens are missing. `SecurityPage` now carries the passkey management
  UI (list, rename, remove-with-password, add) and the public `/login` page carries passkey sign-in;
  the admin-side security screens do not exist.
- **`platform/mobile/`** — Capacitor config/resources only; no app code.

---

## 2. `cloudhost247-node` — open items in the accepted build

### 2a. Capability refusals that remain in adapter profiles

| Adapter | Unfinished / refused capabilities |
|---|---|
| `aws-adapter.ts` | `rescue` (no native EC2 API); `reinstall` gated behind `AWS_ALLOW_ROOT_VOLUME_REPLACEMENT` |
| `digitalocean-adapter.ts` | `console`, `rescue` |
| `contabo-adapter.ts` | `resize`, `console`, `metrics` |
| `proxmox-adapter.ts` | `rescue` |
| `virtualizor-adapter.ts` | `rescue` |
| `solusvm-adapter.ts` | `snapshot`; arm64 `rescue` |
| `mock-adapter.ts` | `console`, `metrics` (refused rather than simulated) |
| `UnavailableNativeProviderAdapter` (`registry.ts`) | undeclared provider kinds fail closed |
| `cpanel-adapter.ts` (deployments) | `restartApplication`, `applicationLogs` |
| `kubernetes-adapter.ts` (deployments) | backup/restore (`K8S_BACKUP_REQUIRES_VELERO`), hosting provisioning |
| `docker-adapter.ts` (deployments) | hosting ops return `HOSTING_REQUIRES_CPANEL_ADAPTER` |

### 2b. Frozen / quarantined artifacts

- **External payment webhook pipeline (Phase 5D)** — `src/routes/webhooks.ts`,
  `src/services/webhook-service.ts`, `src/payments/{stripe,paypal,paystack,sandbox}-gateway.ts`:
  **NOT EXECUTED IN PRODUCTION, NOT DEPLOYED.** Live-gateway verification never performed.
- **Migrations `0023`, `0024`, `0025`, `0041`** — prepared and tested only; held in
  `QUARANTINED_MIGRATIONS`, never run against production.

### 2c. Open verification/staging items

- Vultr `console` capability backfill on stored server/product rows (runbook written, not executed).
- DigitalOcean servers provisioned before the A13 fix still carry stale `console: true`.
- Financial invariant sweep / authorization matrix never run against the production database.
- `server-agent/install.sh` never executed; no real Docker daemon in any test.

---

## 3. Never independently built — vendor, licence-gated, or superseded

| Build | Location | Status |
|---|---|---|
| `the-retired-brand` legacy page-builder addon | *documented in `README.md`; **directory not present in the tree*** | ionCube vendor bytecode; "Not implemented" in parity matrix; never committed here |
| `xtreme_currency_rates` | `modules/addons/xtreme_currency_rates/` | 18 ionCube-encoded PHP files, licence gate; replaced by `cloudhost247_currency` |
| `soyoustart` (admin suite) | `modules/addons/soyoustart/` | vendor licence gates (`licenseNumtoactivate`/`CheckLicense()`) |
| `soyoustart` (dedicated server) | `modules/servers/soyoustart/` | vendor licence gate |
| `soyoustart_vps` | `modules/servers/soyoustart_vps/` | vendor licence gate |
| `ovh_cart` order form | `templates/orderforms/ovh_cart/` | vendor; replacement needed |
| Vendor crons `getServer.php`, `getIpStatus.php`, `priceSync.php`, `emailSend.php` | `crons/` | coupled to WGS classes; hash-locked replacements shipped but vendor files remain |
| `Smtphosting` (ModulesGarden v3) | `modules/servers/Smtphosting/` | third-party, inactive, superseded; 6 zero-byte placeholders |
| `cloudhost247_email` | `modules/servers/cloudhost247_email/` | earlier build — INACTIVE |
| `smmaddon` | `modules/addons/smmaddon/` | prototype, superseded by `cloudhost247_smm` |
| `smmprovisioning` | `modules/servers/smmprovisioning/` | prototype, superseded by `cloudhost247_smm` |

---

## 4. Stub / zero-byte artifacts (13 files)

- `modules/servers/Smtphosting/App/Config/di/services.yml`
- `modules/servers/Smtphosting/Core/Database/data.sql`
- `modules/servers/Smtphosting/Packages/Provisioning/Database/data.sql`
- `modules/servers/Smtphosting/templates/admin/pages/home/home.tpl`
- `modules/servers/Smtphosting/templates/assets/tpl/EasyDCIM/home.tpl`
- `modules/servers/Smtphosting/templates/client/default/pages/home/home.tpl`
- `templates/cloudhost247_legacy/clientareacreditcard.tpl`
- `templates/cloudhost247_legacy/creditcard.tpl`
- `templates/cloudhost247_legacy/pwreset.tpl`
- `templates/cloudhost247_legacy/css/overrides/override.css`
- `templates/cloudhost247_legacy/css/overrides/override.css.new`
- `templates/cloudhost247_legacy/js/overrides/override.js`
- `templates/cloudhost247_legacy/js/overrides/override.js.new`

Classification (audit §C): 6 are third-party vendor placeholders — **do not author**; 7 are
hash-locked by `docs/independent-rebuild/original-file-manifest.sha256`, and the two override
hooks are *supposed* to be empty.

---

## 5. Source-complete but staging-blocked (runtime verification unfinished)

`RDP` · `cloudhost247_broker` · `cloudhost247_integrations` · `cloudhost247_modules` ·
`cloudhost247_builder` · `cloudhost247_passkey` · `cloudhost247_cart_recovery` · `cloudhost247_smm` ·
`cloudhost247_tools` · `phoneservices` · `digitalproducts` · `customaffiliate` · `cloudhost247_theme` ·
`cloudhost247_currency` · `cloudhost247_ovh` — plus `cloudhost247_marketing` (module complete; the
`crons/cloudhost247_marketing.php` delivery worker still has to be scheduled on the host).

**Whole-platform gates still open:** cPanel staging verification (*BLOCKED — NOT PERFORMED*),
visual/browser tests (*NOT PERFORMED*), and GitHub Actions cannot start on this account (billing
blocker), so no commit has a CI signal.
