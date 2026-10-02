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
| A1 | **CloudHost247 Email Marketing** | `modules/addons/cloudhost247_marketing/` | SESSIONS **1–12 DONE — MODULE COMPLETE** — Foundation (16-table guarded migration, settings, dashboard, menu), Subscribers/lists/tags/import/export/suppression (`V110`), Segments (closed rule DSL + live fail-closed evaluation), Templates + block builder (`V120`, sanitizer, rendered-output fidelity, builtin library), Campaigns (pre-send checklist, explicit state machine, UTC scheduling, `MessageTransport` contract), cPanel SMTP sender (shared `SmtpClient` in integrations + vault-backed `SmtpTransport` with sender-domain policy), Queue + delivery worker (`crons/cloudhost247_marketing.php`: audience freezing, idempotent queueing, locking, throttling, backoff, suppression re-check, campaign settle), Tracking + unsubscribe (`cloudhost247-marketing-track.php`: pixel, registered-destination click redirects, RFC 8058 one-click unsubscribe, DSN bounce ingestion, ledger retention), Reporting (`AnalyticsService` + Analytics screen: ledger-only rates, click map, recipient activity, rolling windows — a missing denominator shows as "—"), Automation (`AutomationService`: wait/send journeys, subscriber_added / list_joined / manual triggers, one live run per subscriber, container campaigns delivered through the campaign queue), Security review (personalisation escaping, subject personalisation, link-scheme/link-abuse/greedy-redirect checks, POST+CSRF coverage, no credentials, CSV formula hardening) | — none: all 12 sessions delivered. Session 11 reviewed the attack surface and fixed HTML-context personalisation escaping, missing subject personalisation, the CSV tab/CR/LF formula gap and LIKE-wildcard search; session 12 proved the failure taxonomy, two-worker concurrency and a 120-message exactly-once soak, and fixed the repeat-unsubscribe double count plus the provider-code drop in `SmtpTransport` | `docs/independent-rebuild/EMAIL-MARKETING.md` §"Session log" tracks each session; delivery worker cron `crons/cloudhost247_marketing.php` ships now — schedule it in the system crontab |
| A2 | **CloudHost247 OVH** (addon + server module) | `modules/addons/cloudhost247_ovh/`, `modules/servers/cloudhost247_ovh/` | Signed API client, catalog import, currency-priced preview/apply, existing-service linking, order polling, reverse DNS, provisioning/lifecycle, admin + client views | **Advanced operations:** reinstall, rescue, snapshot, backup status, firewall, IPMI and monitoring are implemented in the admin-only action catalog behind confirmation, typed-service-name guarding for destructive actions and the ledgered, never-auto-retried mutation path. The unit added the three items the API-capability audit had left open: intervention history (list + validated detail), the full boot option list with boot type and netboot kernel selection, and address-scoped firewall reads (protected addresses, rules) plus rule add/delete. Firewall actions can only name an address OVH reports for the linked service. **Still NOT IMPLEMENTED:** automated-backup restore — the verified API surface exposes backup status and a VPS snapshot to revert to, and no restore route will be invented for it. Source-complete for the four PARTIAL items that were actionable in code: automatic configurable-option discovery with value-level exact mapping and derived provenance (V170), normalized hardware/OS/datacenter specifications with a read-only prefill and per-field provenance (V180), a bounded read-only existing-service directory with ranked suggestions and confirmed linking/rebinding, and hand reconciliation that binds a delivered order's service name and completes the operation. Still open: automatic product creation and cross-currency pricing apply (both deliberately non-destructive), and the advanced product-specific actions | `docs/independent-rebuild/AUDIT-AND-PARITY-MATRIX.md`, `docs/independent-rebuild/OVH-INTEGRATION.md`, `docs/independent-rebuild/PRE-STAGING-REPORT.md` |
| A3 | **CloudHost247 Theme Manager** | `modules/addons/cloudhost247_theme/` | Branding, navigation, CMS pages/blocks, banners, testimonials, SEO/OG, sitemap | Source-complete for every listed item. Localized CMS, sitemap and OG metadata were already delivered; this unit added the rest: the page-builder backed product-query landing component (bounded, never invents a price, reports when the catalogue is unavailable), a visual preview of unsaved settings and content that emits the same custom properties as the live head hook, and drag-and-drop ordering with a validated server-side permutation and a numeric no-JavaScript fallback. Block composition (layout template, assigned page slugs, widgets) is now authorable in the admin, which the theme template already consumed. Staging still owns every browser/runtime claim | `docs/independent-rebuild/AUDIT-AND-PARITY-MATRIX.md` §Phase 2, §Source gap |
| A4 | **Node platform — AWS EC2 adapter** | `cloudhost247-node/src/infrastructure/providers/aws-adapter.ts`, profile in `.../providers/configuration.ts` | EC2 create/describe/start/stop/reboot/terminate, snapshots, resize, console output, images, health | Both workflows are now implemented behind an explicit deployment opt-in: reinstall provisions a replacement instance from the target AMI in the same zone/subnet/security groups and only stops the previous instance (never terminates it), and root-volume restore creates a volume from the snapshot in the instance's own zone, stops the instance, detaches the old root (kept, not deleted), attaches the new one at the same device name and restarts only if it was running. Snapshot deletion is implemented. `reinstall` still advertises `false` by default because the capability is deployment-scoped — `AWS_ALLOW_ROOT_VOLUME_REPLACEMENT=true` (or the provider prefix) enables both, and without it every call refuses with `UNSUPPORTED_OPERATION` before a single AWS call. Rescue remains unsupported; CloudWatch metrics remain unavailable. The **"incomplete native adapter"** note now covers rescue and metrics only — every lifecycle and root-volume workflow has a real implementation | `configuration.ts` (aws profile `notes`), `aws-adapter.ts:362`, `docs/NODE_PLATFORM_STATUS.md` §"honest template capabilities" |
| A5 | **Node platform — Contabo adapter** | `cloudhost247-node/src/infrastructure/providers/contabo-adapter.ts` | OAuth2 client, create/reinstall/lifecycle, images, snapshots | `resize: false`, `console: false`, `metrics: false`, `rescue: false`; rescue throws *"Contabo rescue mode … is not exposed by this adapter"*. Also named an **"incomplete native adapter [that] cannot be activated"** | `configuration.ts` (contabo profile), `contabo-adapter.ts:389-398` | The advertised refusals are now pinned by tests: the four profiles/adapters that declare `resize`/`console`/`metrics`/`rescue` false are asserted to actually refuse each one with a non-retryable `UNSUPPORTED_OPERATION` before any provider request, so a capability flag can no longer drift away from the implementation (`tests/unit/provider-capability-truth.test.ts`). One behavioural defect found by that test is fixed: EC2 `enableRescue` threw synchronously instead of rejecting.
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

## D. Root routes that used to render the legacy theme shell — CLOSED

**Every root page route now renders independent content.** They used to call
`setTemplate('cloudhost247_legacy')` (or a legacy-only template), i.e. they fell through to the vendor
theme's block-renderer — which prints *"It is very easy to assign the blocks to page via our Drag N
Drop Blocks Manager"* when nothing is assigned — and depended on the encoded vendor helper (B1) and its
`mod_cloudhost247_theme_pages` / `mod_cloudhost247_theme_settings` tables.

They now render a published entry from the independent theme content store through the shared front
controller `modules/addons/cloudhost247_theme/lib/PublicPage.php`, with the same URLs, titles and
breadcrumbs:

- **Content pages:** `dedicated-server.php`, `developer-friendly.php`, `domain.php`,
  `enterprise-servers.php`, `game-servers.php`, `offers.php`, `vps-publiccloud.php`,
  `cloudhost247-sample.php`, `future-element.php`, `comingsoon.php`, `all-element-cloudhost247.php`,
  `legal-notice.php`, `help-center.php`, `blog.php`, `data-protection-standards.php`,
  `terms-of-service.php`, `tables.php`, `ssl-certificate.php`, `website-design.php`.
- **Product pages:** `cpanel-hosting.php`, `plesk-hosting.php`, `vps-hosting.php`,
  `vps-privatecloud.php`, `web-hosting.php`, `windows-hosting.php`, `wordpress-hosting.php`,
  `cloudhost247-vps-sample.php`. A product page whose published entry names a WHMCS product group also
  lists that group's products, through the same bounded read-only catalogue reader the landing blocks
  use (`ProductComponents`), with the group and billing cycle set in the Theme Manager. An unavailable
  catalogue is stated on the page instead of rendering an empty grid.
- **404:** `notfound.php` always answers 404, using the operator's published wording when it exists.
- **Redirect:** `dedeicated-server.php`, the misspelled duplicate, is a permanent 301 to
  `dedicated-server.php`.

A route whose slug has no published entry answers 404 with a plain explanation instead of a
placeholder, and a failure to read the content store is a 404 rather than a fatal error on a public
page. Nothing in the front controller touches the vendor tables or the vendor shell; the only remaining
reference to `cloudhost247_legacy` in the tree is the retained theme asset directory itself and the
compatibility default value in the settings store.

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
