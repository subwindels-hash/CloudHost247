# Unfinished module build code — consolidated name list

**Compiled:** 2026-10-08. **Verified against the working tree at `8369f7b`** (branch
`arena/2dd66601-cloudhost247`), not copied from headers.
**Sources consolidated:** `docs/UNFINISHED-MODULES.md` (the long-form audit, A1–A23 + B/C/D/E),
`docs/UNFINISHED-BUILD-CODE-NAMES.md` (the progress-log roll-up, rows 1–15), `platform/MIGRATION.md`,
`cloudhost247-node/docs/NODE_PLATFORM_STATUS.md`, and a fresh scan of the tree.

This page is the **name index** — every module/build artifact whose code is not finished and verified,
grouped by *why* it is unfinished. What each one is missing lives in the two source documents above.

**Completion log** (kept at the top; the sections below are edited in place as rows are closed):

| Closed | Module(s) | Evidence |
|---|---|---|
| 2026-10-08 | §1.1 rows 1–2 — `platform/src/domains/cloudflare.js` + `admin-cloudflare.js` (live Cloudflare egress) | `platform/src/lib/cloudflare-client.js` (live API v4 client, 37 unit/wire tests), `cloudflare-service.js`, `cloudflare-sync.js`, `cloudflare-fulfilment.js`; `platform/tests/cloudflare-client.test.js` + `platform/tests/cloudflare-egress.test.js` (34 route tests over the real app against a fake Cloudflare at `platform/tests/fixtures/fake-cloudflare.js`). Full suite: **742 pass / 0 fail**. No real Cloudflare account was reachable from this environment — every provider claim is verified against the loopback fake, never against api.cloudflare.com. |

---

## 1. In-build — code exists, features explicitly missing

### 1.1 `platform/` — live provider egress still deferred (4 modules remain of 6)

The domain modules in `platform/` that still carry a `deferred` marker for live integration
(`ls platform/src/domains` = 45 modules). **Rows 1–2 are now closed** — both Cloudflare modules reach
Cloudflare inside the request and refuse with a named reason when they cannot:

| # | Module | Deferred capability | State |
|---|---|---|---|
| 1 | `platform/src/domains/cloudflare.js` | Live Cloudflare HTTP client, live record write, live purge (writes go to the synchronized cache; purge queues a durable job) | **closed 2026-10-08** |
| 2 | `platform/src/domains/admin-cloudflare.js` | Live Cloudflare egress — "Test Connection" never fakes success | **closed 2026-10-08** |
| 3 | `platform/src/domains/domain-services.js` | Availability / WHOIS-RDAP lookup / appraisal provider connector (returns `provider_unavailable`) | open |
| 4 | `platform/src/domains/admin-domain-services.js` | Registrar transfer refresh poll (returns `status: 'deferred'`) | open |
| 5 | `platform/src/domains/ai-os.js` | Model adapter — Copilot inference (prompt is recorded, no reply is produced) | open |
| 6 | `platform/src/domains/ai-support.js` | LLM inference (human agents reply manually) | open |

Supporting library files that still carry the marker with them (not modules, listed for completeness):
`platform/src/lib/provider-adapters.js`, `platform/src/lib/provider-egress.js`, `platform/src/store/schema.js`.

### 1.2 `platform/spa/` — customer + admin SPA, partially ported (17 page modules)

`platform/spa/src/pages/`: `AdminContentPage` · `AdminCustomerDetailPage` · `AdminCustomersPage` ·
`AdminDashboardPage` · `AdminLayout` · `AdminSiteSettingsPage` · `AdminTicketDetailPage` ·
`AdminTicketsPage` · `AdminUsersPage` · `BillingPage` · `CartPage` · `CatalogPage` · `DashboardPage` ·
`InvoiceDetailPage` · `SecurityPage` · `ServicesPage` · `SupportPage`

**Missing, by name: the remaining ~35 admin groups** (catalog authoring, servers, DNS, Cloudflare,
marketplace, AI/tools, security-number policy, …), the customer-facing **DNS**, **Cloudflare** and
**marketplace** screens, **server detail**, and the **mobile shell**. No browser has rendered any ported
page in this environment.

### 1.3 `platform/mobile/` — no app code

`capacitor.config.json`, `package.json`, `resources/icon.png`, `resources/splash.png` only.

### 1.4 `cloudhost247-node` — capability refusals that remain in adapter profiles

| # | Adapter | Unfinished / refused capability |
|---|---|---|
| 1 | `aws-adapter.ts` | `rescue` (no native EC2 API); `reinstall` gated behind `AWS_ALLOW_ROOT_VOLUME_REPLACEMENT` |
| 2 | `digitalocean-adapter.ts` | `console`, `rescue` |
| 3 | `contabo-adapter.ts` | `resize`, `console`, `metrics` |
| 4 | `proxmox-adapter.ts` | `rescue` |
| 5 | `virtualizor-adapter.ts` | `rescue` (enduser API/4083 only; this adapter uses Admin API/4085) |
| 6 | `solusvm-adapter.ts` | `snapshot`; arm64 `rescue` |
| 7 | `mock-adapter.ts` | `console`, `metrics` (refused rather than simulated) |
| 8 | `UnavailableNativeProviderAdapter` (`registry.ts`) | undeclared provider kinds fail closed |
| 9 | `cpanel-adapter.ts` (deployments) | `restartApplication`, `applicationLogs` |
| 10 | `kubernetes-adapter.ts` (deployments) | backup/restore (`K8S_BACKUP_REQUIRES_VELERO`), hosting provisioning |
| 11 | `docker-adapter.ts` (deployments) | hosting ops return `HOSTING_REQUIRES_CPANEL_ADAPTER` |

### 1.5 `cloudhost247-node` — route surface deferred to later phases

| # | Module | Deferred |
|---|---|---|
| 1 | `src/routes/billing.ts` | Admin/staff invoice-viewing routes — deferred to Phase 5F |
| 2 | `src/routes/commerce.ts` | Admin/staff order-viewing and management routes — deferred to Phase 5F |

### 1.6 `server-agent/` — runtime verification unfinished

`install.sh` never executed; no real Docker daemon in any test; no request has crossed a real network
between the agent and the control plane; no real multi-gigabyte archive hashed.

---

## 2. Frozen — NOT EXECUTED IN PRODUCTION, NOT DEPLOYED

| # | Build | Location |
|---|---|---|
| 1 | External payment webhook pipeline (Phase 5D) — live-gateway verification never performed | `cloudhost247-node/src/routes/webhooks.ts`, `src/services/webhook-service.ts`, `src/payments/{stripe,paypal,paystack,sandbox}-gateway.ts` |
| 2 | Migration `0023` — billing-invariant enforcement | `cloudhost247-node/database/migrations/` (`QUARANTINED_MIGRATIONS`) |
| 3 | Migration `0024` — webhook event ledger | same |
| 4 | Migration `0025` | same |
| 5 | Migration `0041` — blocks production progress past `0040` until separately authorized | same |
| 6 | Blockonomics (Bitcoin/USDT) gateway | `modules/gateways/blockonomics/` — used by the WHMCS build; **no `platform/` equivalent exists at all** |

---

## 3. Never independently built — vendor, licence-gated, or superseded

| # | Build name | Location | Why unfinished |
|---|---|---|---|
| 1 | legacy page-builder addon *(vendor name redacted as `[retired-addon]`)* | *documented in `README.md`; **directory not present in the tree*** | ionCube vendor bytecode; "Not implemented" in the parity matrix; never committed |
| 2 | `xtreme_currency_rates` | `modules/addons/xtreme_currency_rates/` | 18 ionCube-encoded PHP files + `license_verify.php` + `security/ioncube_callback.php`; replaced by `cloudhost247_currency` |
| 3 | `soyoustart` (admin suite) | `modules/addons/soyoustart/` | vendor licence gates (`licenseNumtoactivate` / `CheckLicense()`) |
| 4 | `soyoustart` (dedicated server) | `modules/servers/soyoustart/` | vendor licence gate |
| 5 | `soyoustart_vps` | `modules/servers/soyoustart_vps/` | vendor licence gate |
| 6 | `ovh_cart` order form | `templates/orderforms/ovh_cart/` | vendor; replacement needed |
| 7 | Vendor crons `getServer.php`, `getIpStatus.php`, `priceSync.php`, `emailSend.php` | `crons/` | coupled to WGS classes; hash-locked replacements shipped (`crons/cloudhost247_ovh.php`, OVH `PricingService`, `crons/cloudhost247_marketing.php`) but the vendor files remain |
| 8 | `Smtphosting` (ModulesGarden v3) | `modules/servers/Smtphosting/` | third-party, inactive, superseded; 6 zero-byte placeholders |
| 9 | `cloudhost247_email` | `modules/servers/cloudhost247_email/` | earlier build — INACTIVE |
| 10 | `smmaddon` | `modules/addons/smmaddon/` | prototype, superseded by `cloudhost247_smm` |
| 11 | `smmprovisioning` | `modules/servers/smmprovisioning/` | prototype, superseded by `cloudhost247_smm` |
| 12 | `RDP` (vendor archive extracted over the secure rebuild) | `modules/servers/RDP/` | vendor module active; provider API authorization + licence/redistribution prerequisites unsatisfied |

---

## 4. Stub / zero-byte artifacts — 13 files, classified (do not author)

**Third-party vendor placeholders — DO NOT AUTHOR (6), in `modules/servers/Smtphosting/`:**
`App/Config/di/services.yml` · `Core/Database/data.sql` · `Packages/Provisioning/Database/data.sql` ·
`templates/admin/pages/home/home.tpl` · `templates/assets/tpl/EasyDCIM/home.tpl` ·
`templates/client/default/pages/home/home.tpl`

**Hash-locked empty + vestigial names — superseded flows (3), in `templates/cloudhost247_legacy/`:**
`clientareacreditcard.tpl` · `creditcard.tpl` · `pwreset.tpl`

**Hash-locked empty — and empty is the correct shipped state (4):**
`templates/cloudhost247_legacy/css/overrides/override.css` (+ `override.css.new`) ·
`templates/cloudhost247_legacy/js/overrides/override.js` (+ `override.js.new`)

Classified 2026-10-02 and closed by verification, not by authoring code. Seven of the thirteen are
hash-locked by `docs/independent-rebuild/original-file-manifest.sha256`; writing a byte into any of
them turns the release candidate red.

---

## 5. Source-complete but staging-blocked — runtime verification unfinished

`RDP` · `cloudhost247_broker` · `cloudhost247_integrations` · `cloudhost247_modules` ·
`cloudhost247_builder` · `cloudhost247_passkey` · `cloudhost247_cart_recovery` · `cloudhost247_smm` ·
`cloudhost247_tools` · `phoneservices` · `digitalproducts` · `customaffiliate` · `cloudhost247_theme` ·
`cloudhost247_currency` · `cloudhost247_ovh` · `cloudhost247_marketing`
*(module complete — the `crons/cloudhost247_marketing.php` delivery worker still has to be scheduled on
the host)*

**Whole-platform gates still open:** cPanel staging verification — *BLOCKED, NOT PERFORMED*;
visual/browser tests — *NOT PERFORMED*. Production database is read-only from here.

---

## 6. Proposed only — specification written, zero code

| # | Proposal | Location |
|---|---|---|
| 1 | Phase 5E — Customer Billing Portal & Invoices UI | `docs/PROPOSED_SCOPE_PHASE_5E_BILLING_PORTAL.md` |
| 2 | Phase 5F — Staff & Admin Billing Management & Financial Operations | `docs/PROPOSED_SCOPE_PHASE_5F_ADMIN_BILLING.md` |
| 3 | Phase 5G — End-to-End Billing Lifecycle, Reconciliation & Platform Verification | `docs/PROPOSED_SCOPE_PHASE_5G_RECONCILIATION.md` |
| 4 | Phase 5D — External Payment Webhook Pipeline | `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` — stamped *NOT AUTHORIZED · NOT IMPLEMENTED · NOT DEPLOYED* |

---

## 7. Open verification / staging items (data and runs, not code)

- Vultr `console` capability backfill on stored server/product rows — runbook written
  (`docs/VULTR_CONSOLE_BACKFILL_RUNBOOK.md`), **not executed** against staging.
- DigitalOcean servers provisioned before the A13 fix still carry stale `console: true`.
- Financial invariant sweep / authorization matrix never run against the production database.
- Webhook pipeline unfreeze — runbook written (`docs/WEBHOOK_PIPELINE_UNFREEZE_RUNBOOK.md`),
  authorization not given.
- `platform/`: no call has been made to a real provider account from any ported adapter. This now
  covers Cloudflare too: the rewritten client is verified against a loopback fake of the Cloudflare
  API v4 (`platform/tests/fixtures/fake-cloudflare.js`), never against `api.cloudflare.com`. What the
  fakes cannot settle — Cloudflare's real pagination caps, per-plan setting availability, live rate
  limits, and whether a real account's token carries every permission the client assumes — is
  unverified until someone runs the client against a staging account.

---

## Quick copy/paste name list

**Platform — deferred egress:** `domain-services` · `admin-domain-services` · `ai-os` · `ai-support`
*(`cloudflare` and `admin-cloudflare` were closed 2026-10-08 — see the completion log)*

**Platform — partial:** `platform/spa` (17 page modules ported, ~35 admin groups + DNS/Cloudflare/
marketplace/server-detail/mobile shell missing) · `platform/mobile` (no app code)

**Node adapters — refused capabilities:** `aws` (rescue; reinstall gated) · `digitalocean`
(console, rescue) · `contabo` (resize, console, metrics) · `proxmox` (rescue) · `virtualizor` (rescue) ·
`solusvm` (snapshot, arm64 rescue) · `mock` (console, metrics) · `UnavailableNativeProviderAdapter` ·
`cpanel-adapter` (restartApplication, applicationLogs) · `kubernetes-adapter` (backup/restore, hosting
provisioning) · `docker-adapter` (hosting ops)

**Node routes deferred:** `billing.ts` (admin invoice views → 5F) · `commerce.ts` (admin order views → 5F)

**Frozen:** webhook pipeline (`routes/webhooks.ts`, `services/webhook-service.ts`,
`payments/{stripe,paypal,paystack,sandbox}-gateway.ts`) · migrations `0023` · `0024` · `0025` · `0041` ·
Blockonomics gateway

**Never independently built:** `[retired-addon]` *(not in the tree)* · `xtreme_currency_rates` ·
`soyoustart` (addon) · `soyoustart` (server) · `soyoustart_vps` · `ovh_cart` · vendor crons
`getServer.php` / `getIpStatus.php` / `priceSync.php` / `emailSend.php` · `Smtphosting` ·
`cloudhost247_email` · `smmaddon` · `smmprovisioning` · `RDP`

**Stubs — 13 zero-byte files:** 6 × `Smtphosting` vendor placeholders · `clientareacreditcard.tpl` ·
`creditcard.tpl` · `pwreset.tpl` · `override.css`(+`.new`) · `override.js`(+`.js.new`)

**Source-complete, staging-blocked:** `RDP` · `cloudhost247_broker` · `cloudhost247_integrations` ·
`cloudhost247_modules` · `cloudhost247_builder` · `cloudhost247_passkey` · `cloudhost247_cart_recovery` ·
`cloudhost247_smm` · `cloudhost247_tools` · `phoneservices` · `digitalproducts` · `customaffiliate` ·
`cloudhost247_theme` · `cloudhost247_currency` · `cloudhost247_ovh` · `cloudhost247_marketing`

**Proposed only:** Phase 5D webhook pipeline · Phase 5E billing portal · Phase 5F admin billing ·
Phase 5G reconciliation
