# Unfinished module build code — name inventory

**Repository:** `subwindels-hash/CloudHost247`
**Branch audited:** `arena/01a0f9c1-cloudhost247`
**Audit date:** 2026-10-01
**Method:** static audit of the repository's own build records (`docs/NODE_PLATFORM_STATUS.md`,
`docs/independent-rebuild/*`, per-module `README.md`), `NOT IMPLEMENTED` / `planned` / session-log
markers in source and docs, adapter capability profiles, unsupported-operation code paths,
zero-byte/placeholder files, and modules documented as vendor-only, gated, superseded or inactive.

> **Reading this list.** "Unfinished" is used in three distinct senses, kept separate below:
> **(A)** the build is still in progress (code exists, features are explicitly missing),
> **(B)** the code was never independently built (vendor/licence-gated or superseded),
> **(C)** the artifact is a stub/placeholder. A module that is *source-complete but
> staging-blocked* is listed in section D rather than called unfinished.

---

## A. Build in progress — code exists, features explicitly missing

| # | Module / build name | Location | Built so far | Missing (named in the build record) | Evidence |
|---|---|---|---|---|---|
| A1 | **CloudHost247 Email Marketing** | `modules/addons/cloudhost247_marketing/` | SESSIONS **1–8 DONE** — Foundation (16-table guarded migration, settings, dashboard, menu), Subscribers/lists/tags/import/export/suppression (`V110`), Segments (closed rule DSL + live fail-closed evaluation), Templates + block builder (`V120`, sanitizer, rendered-output fidelity, builtin library), Campaigns (pre-send checklist, explicit state machine, UTC scheduling, `MessageTransport` contract), cPanel SMTP sender (shared `SmtpClient` in integrations + vault-backed `SmtpTransport` with sender-domain policy), Queue + delivery worker (`crons/cloudhost247_marketing.php`: audience freezing, idempotent queueing, locking, throttling, backoff, suppression re-check, campaign settle), Tracking + unsubscribe (`cloudhost247-marketing-track.php`: pixel, registered-destination click redirects, RFC 8058 one-click unsubscribe, DSN bounce ingestion, ledger retention) | **SESSIONS 9–12 `planned`:** 9 Analytics · 10 Automation · 11 Security review · 12 Production QA | `docs/independent-rebuild/EMAIL-MARKETING.md` §"Session log" tracks each session; delivery worker cron `crons/cloudhost247_marketing.php` ships now — schedule it in the system crontab |
| A2 | **CloudHost247 OVH** (addon + server module) | `modules/addons/cloudhost247_ovh/`, `modules/servers/cloudhost247_ovh/` | Signed API client, catalog import, currency-priced preview/apply, existing-service linking, order polling, reverse DNS, provisioning/lifecycle, admin + client views | **NOT IMPLEMENTED — API/product dependency:** reinstall, rescue, snapshot, backup, firewall, IPMI, monitoring. **PARTIAL:** automatic configurable-option discovery, normalized hardware/OS/datacenter UI, existing-service link UI, service-name binding, advanced product-specific actions | `docs/independent-rebuild/AUDIT-AND-PARITY-MATRIX.md`, `docs/independent-rebuild/OVH-INTEGRATION.md`, `docs/independent-rebuild/PRE-STAGING-REPORT.md` |
| A3 | **CloudHost247 Theme Manager** | `modules/addons/cloudhost247_theme/` | Branding, navigation, CMS pages/blocks, banners, testimonials, SEO/OG, sitemap | **Recorded PARTIAL:** localized CMS, dedicated product-query landing components, sitemap, OG metadata, visual preview, drag-and-drop ordering (only numeric section ordering was delivered at that record; some items were closed later — see source-gap table) | `docs/independent-rebuild/AUDIT-AND-PARITY-MATRIX.md` §Phase 2, §Source gap |
| A4 | **Node platform — AWS EC2 adapter** | `cloudhost247-node/src/infrastructure/providers/aws-adapter.ts`, profile in `.../providers/configuration.ts` | EC2 create/describe/start/stop/reboot/terminate, snapshots, resize, console output, images, health | `reinstall: false` — *"Reinstall and root-volume restore require an explicit replacement-instance workflow and are intentionally unavailable"*; rescue unsupported; metrics unavailable. The build record calls it an **"incomplete native adapter [that] cannot be activated"** | `configuration.ts` (aws profile `notes`), `aws-adapter.ts:362`, `docs/NODE_PLATFORM_STATUS.md` §"honest template capabilities" |
| A5 | **Node platform — Contabo adapter** | `cloudhost247-node/src/infrastructure/providers/contabo-adapter.ts` | OAuth2 client, create/reinstall/lifecycle, images, snapshots | `resize: false`, `console: false`, `metrics: false`, `rescue: false`; rescue throws *"Contabo rescue mode … is not exposed by this adapter"*. Also named an **"incomplete native adapter [that] cannot be activated"** | `configuration.ts` (contabo profile), `contabo-adapter.ts:389-398` |
| A6 | **Rescue mode across provider adapters** | `cloudhost247-node/src/infrastructure/providers/*.ts` | Implemented for **Hetzner** and **OpenStack** only | Rescue declared `false` / `unsupportedRescue()` for **AWS, Contabo, DigitalOcean, Vultr, OVH, Proxmox, Virtualizor, SolusVM, generic_http, mock** — 10 of 12 adapters | `providers/common.ts:unsupportedRescue`, `ADAPTER_PROFILES` capability matrix |
| A7 | **Node deployment adapters** | `cloudhost247-node/src/deployments/adapters/` | Docker/Kubernetes app deployment, cPanel hosting provisioning | **cPanel adapter:** `startApplication`, `stopApplication`, `restartApplication`, `applicationStatus`, `applicationLogs`, `runBackup`, `restoreBackup` throw `UnsupportedOperationError`. **Docker adapter:** `provisionHosting`, `suspendHosting`, `terminateHosting` unsupported. **Kubernetes adapter:** `start/stopApplication`, `applicationStatus`, `applicationLogs`, `runBackup`/`restoreBackup` (*"Velero integration is the documented path"*), `provisionHosting`, `suspendHosting`, `terminateHosting` unsupported | Source files, `types.ts:UnsupportedOperationError` |
| A8 | **Unknown/undeclared provider adapters** | `cloudhost247-node/src/infrastructure/providers/registry.ts:30-106` | — | `UnavailableNativeProviderAdapter` fails closed with *"The `<adapter>` native adapter is not enabled in this CloudHost247 build"* for any adapter kind that has no implementation | `registry.ts` |
| A9 | **External payment webhook pipeline (Phase 5D)** | `cloudhost247-node/src/routes/webhooks.ts`, `src/services/webhook-service.ts`, `src/payments/{stripe,paypal,paystack,sandbox}-gateway.ts` | Code implemented and tested (32 integration tests), **migration 0024 prepared** | **Frozen: NOT EXECUTED IN PRODUCTION**; `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` is stamped *"NOT AUTHORIZED · NOT IMPLEMENTED · NOT DEPLOYED"*; **PR #12 remains OPEN and UNMERGED** | `docs/NODE_PLATFORM_STATUS.md` §Phase 5D, §Standing restrictions |
| A10 | **Database migrations prepared but never executed** | `cloudhost247-node/database/migrations/` | `0023_enforce_billing_invariants.sql`, `0024_create_webhook_events.sql`, `0025_*`, `0041_*` | Standing restriction: *"Prepared and tested migration artifacts only. **NOT authorized for production execution**"* | `docs/NODE_PLATFORM_STATUS.md` §Standing restrictions |
| A11 | **Node DNS live connectors** (`cloudflare`, `route53`) | `cloudhost247-node/src/dns/providers.ts` | Provider interface + credential checks | Every live call path throws `SERVICE_UNAVAILABLE: … live API connector is unconfigured in this environment` — the adapters are not wired until an operator configures credentials | `src/dns/providers.ts:58-124` |

---

## B. Never independently built — vendor, licence-gated, or superseded builds

| # | Module name | Location | Why it counts as unfinished | Evidence |
|---|---|---|---|---|
| B1 | `[retired-addon]` (legacy CloudHost247 theme-helper page builder) | `modules/addons/[retired-addon]/` | All 63 PHP files are **ionCube-encoded**; *"**Not implemented**"* in the parity matrix. Licence/activation behaviour cannot be inspected; the vendor block manager still decides whether the pinned root pages render content | `docs/independent-rebuild/AUDIT-AND-PARITY-MATRIX.md` (rows 1) |
| B2 | `xtreme_currency_rates` (Xtreme Currency Rates 6.0) | `modules/addons/xtreme_currency_rates/` | All 18 PHP encoded, explicit `license_verify.php` + security callback; *"**Not implemented**"*; replaced by the independent `cloudhost247_currency` | `AUDIT-AND-PARITY-MATRIX.md` row 4, `INSTALLATION-AND-UPGRADE.md` |
| B3 | `soyoustart` (admin suite) | `modules/addons/soyoustart/` | Vendor code with `licenseNumtoactivate` / `CheckLicense()` gates; *"**Existing/vendor only**"*; only partially replaced by `cloudhost247_ovh` (see A2) | `AUDIT-AND-PARITY-MATRIX.md` row 5 |
| B4 | `soyoustart` (dedicated server module) | `modules/servers/soyoustart/` | Same vendor licence gate; *"Existing/vendor only"* | `AUDIT-AND-PARITY-MATRIX.md` row 6 |
| B5 | `soyoustart_vps` (VPS server module) | `modules/servers/soyoustart_vps/` | Same vendor licence gate; *"Existing/vendor only"* | `AUDIT-AND-PARITY-MATRIX.md` row 7 |
| B6 | `ovh_cart` order form | `templates/orderforms/ovh_cart/` | *"Existing/vendor; replacement needed"* — inherits WHMCS `standard_cart` | `AUDIT-AND-PARITY-MATRIX.md` row 8 |
| B7 | Vendor cron scripts `getServer.php`, `getIpStatus.php`, `priceSync.php`, `emailSend.php` | `crons/` | Coupled to WGS classes/tables; *"Existing/vendor only"*; replacement planned | `AUDIT-AND-PARITY-MATRIX.md` row 9, `docs/pre-restructuring-audit.md` §5 |
| B8 | `Smtphosting` (ModulesGarden v3 provisioning) | `modules/servers/Smtphosting/` | Third-party vendor module shipped incomplete — **6 zero-byte placeholder files** (see C1) | file scan; `docs/RESTRUCTURING.md` line 144 |
| B9 | `cloudhost247_email` (earlier email provisioning build) | `modules/servers/cloudhost247_email/` | Documented as *"an earlier, **inactive** build"*, superseded by `cloudhost247_email_hosting` | root `README.md`, modules table note |
| B10 | `smmaddon` + `smmprovisioning` (single-provider SMM prototype) | `modules/addons/smmaddon/`, `modules/servers/smmprovisioning/` | Prototype explicitly superseded by `cloudhost247_smm`; left in tree untouched/inactive | `modules/addons/cloudhost247_smm/README.md` |

---

## C. Stub / placeholder artifacts (files that exist but contain nothing)

| # | File | Size | Note |
|---|---|---|---|
| C1 | `modules/servers/Smtphosting/App/Config/di/services.yml` | 0 B | placeholder |
| C2 | `modules/servers/Smtphosting/Core/Database/data.sql` | 0 B | placeholder |
| C3 | `modules/servers/Smtphosting/Packages/Provisioning/Database/data.sql` | 0 B | placeholder |
| C4 | `modules/servers/Smtphosting/templates/admin/pages/home/home.tpl` | 0 B | placeholder |
| C5 | `modules/servers/Smtphosting/templates/assets/tpl/EasyDCIM/home.tpl` | 0 B | placeholder |
| C6 | `modules/servers/Smtphosting/templates/client/default/pages/home/home.tpl` | 0 B | placeholder |
| C7 | `templates/cloudhost247_legacy/clientareacreditcard.tpl` | 0 B | placeholder theme page |
| C8 | `templates/cloudhost247_legacy/creditcard.tpl` | 0 B | placeholder theme page |
| C9 | `templates/cloudhost247_legacy/pwreset.tpl` | 0 B | placeholder theme page |
| C10 | `templates/cloudhost247_legacy/css/overrides/override.css` / `.css.new` | 0 B | override hooks never filled in |
| C11 | `templates/cloudhost247_legacy/js/overrides/override.js` / `.js.new` | 0 B | override hooks never filled in |
| C12 | `cloudhost247-node/frontend/src/components/Placeholder.tsx` | — | Phase-1 "route is part of the routing foundation … feature will be implemented in a later phase" component; **no page imports it any more** — dead scaffold |
| C13 | `cloudhost247-node/src/ai/knowledge.ts` | 204 lines | Deliberately a small curated knowledge base, not a general assistant: *"The operator can answer only when a matching entry exists; everything else is escalated."* (intentional scope boundary, listed for completeness) |

---

## D. Route stubs that render the legacy theme shell instead of real content

**D1 — Content-less stubs.** These root pages have **no dedicated template**, carry no page logic,
and call `setTemplate('cloudhost247_legacy')`, i.e. they fall through to the vendor theme's
block-renderer (`templates/cloudhost247_legacy/cloudhost247_legacy.tpl`), which prints
*"It is very easy to assign the blocks to page via our Drag N Drop Blocks Manager"* when no blocks
are assigned for that page:

`dedeicated-server.php` (also a misspelling duplicate of `dedicated-server.php`), `dedicated-server.php`,
`developer-friendly.php`, `domain.php`, `enterprise-servers.php`, `game-servers.php`, `offers.php`,
`vps-publiccloud.php`, `cloudhost247-sample.php`.

**D2 — Legacy-theme-dependent pages.** These read `mod_cloudhost247_theme_pages` /
`mod_cloudhost247_theme_settings` (tables owned by the **encoded vendor theme-helper addon**, B1) and
also fall back to the same `cloudhost247_legacy` shell template — the code is real, but it cannot render
anything without the vendor helper and its block assignments:

`cpanel-hosting.php`, `plesk-hosting.php`, `vps-hosting.php`, `vps-privatecloud.php`,
`web-hosting.php`, `website-design.php`, `windows-hosting.php`, `wordpress-hosting.php`,
`ssl-certificate.php`, `tables.php`, `cloudhost247-vps-sample.php`.

**D3 — Thin wrappers** whose templates exist in the theme but whose content likewise depends on the
encoded vendor helper: `future-element.php`, `comingsoon.php`, `all-element-cloudhost247.php`,
`notfound.php`, `legal-notice.php`, `help-center.php`, `blog.php`.

---

## E. Source-complete but *not* finished — blocked on staging/verification (for contrast)

Not "unfinished code", but none of these may be called done until the gate closes:

- **Whole-platform gates:** *cPanel staging verification: `BLOCKED — NOT PERFORMED`*;
  *Visual/browser tests: `NOT PERFORMED`* (headless browsers unavailable); production DB read-only.
- **Modules whose runtime verification is BLOCKED — STAGING REQUIRED:** `modules/servers/RDP/`
  (also needs provider API authorization before activation), `cloudhost247_broker`,
  `cloudhost247_integrations`, `cloudhost247_modules`, `cloudhost247_builder`,
  `cloudhost247_passkey`, `cloudhost247_cart_recovery`, `cloudhost247_smm`, `cloudhost247_tools`,
  `phoneservices`, `digitalproducts`, `customaffiliate`, `cloudhost247_theme`,
  `cloudhost247_currency`, `cloudhost247_ovh`.

---

## Quick name list (copy/paste)

**In-build first-party:** `cloudhost247_marketing` · `cloudhost247_ovh` (advanced ops) ·
`cloudhost247_theme` (partials)

**In-build Node adapters/modules:** `aws` · `contabo` · rescue-mode for `digitalocean`, `vultr`,
`ovh`, `proxmox`, `virtualizor`, `solusvm`, `generic_http`, `mock` · `cpanel-adapter` ·
`docker-adapter` · `kubernetes-adapter` · `UnavailableNativeProviderAdapter` ·
webhook pipeline (frozen) · migrations `0023`, `0024`, `0025`, `0041`

**Never independently built (vendor/gated/superseded):** `[retired-addon]` ·
`xtreme_currency_rates` · `soyoustart` (addon) · `soyoustart` (server) · `soyoustart_vps` ·
`ovh_cart` · vendor crons `getServer.php` / `getIpStatus.php` / `priceSync.php` / `emailSend.php` ·
`Smtphosting` · `cloudhost247_email` (inactive) · `smmaddon` + `smmprovisioning` (prototype)

**Stubs / zero-byte:** 6 × `Smtphosting` placeholder files · `clientareacreditcard.tpl` ·
`creditcard.tpl` · `pwreset.tpl` · `override.css`(+`.new`) · `override.js`(+`.new`) ·
`Placeholder.tsx` (dead)
