# Unfinished module build code — name inventory

**Repository:** `subwindels-hash/CloudHost247`
**Branch audited:** `arena/01a0f9c1-cloudhost247`
**Audit date:** 2026-10-01
**Re-audited:** 2026-10-02 on `arena/01a0fbc1-cloudhost247` (tip `e31604e`) — every row re-verified against the
tree; **4 claims found stale and corrected in place**, each marked `Corrected 2026-10-02`:
**B1** `[retired-addon]` is not in the repository (never committed), **C12** `Placeholder.tsx` does not exist,
**A5** Contabo `rescue` is implemented (not `false`), **A9** PR #12 is CLOSED (not open).
The `"incomplete native adapter"` note quoted by A4/A5 exists nowhere in source.

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

> **A2 verification (2026-10-02).** Two of this row's claims were checked against source and one is **false**.
>
> - **Cross-currency pricing apply is IMPLEMENTED, not open.** `lib/Pricing/PricingService.php` has both `preview()` and `apply()`. `preview()` converts through WHMCS's own rates (`conversion_rate = $target->rate / $source->rate`, margin + rounding applied by `PriceCalculator`), refuses a non-positive rate, and refuses to run when the `tblpricing` row is absent rather than creating it silently. `apply()` requires explicit confirmation, runs in a transaction with `lockForUpdate()`, re-checks that the live WHMCS price still equals the previewed `current_price` (rejecting a stale preview), writes `tblpricing`, flips the preview to `applied`, and writes an audit record. It is wired to the admin UI as the `price_apply` operation at `lib/Services/AdminController.php:43`.
> - **Automatic product creation IS genuinely absent.** `lib/Products/HostingProductManager.php` exposes `listProducts`, `specificationPrefill`, `details`, `save` (update of an existing product) and `linkAddon` — there is no create path, so a WHMCS product must still be created by hand before it can be mapped.
> - **This module cannot be executed in the CI sandbox.** `php` is not installed and the sandbox has no root, so `tests/ovh/run.php` cannot be run and no PHP change here is verifiable beyond static reading. Automatic product creation writes to `tblproducts`/`tblpricing`, so it was deliberately left unimplemented rather than shipped unverified.

| A3 | **CloudHost247 Theme Manager** | `modules/addons/cloudhost247_theme/` | Branding, navigation, CMS pages/blocks, banners, testimonials, SEO/OG, sitemap | Source-complete for every listed item. Localized CMS, sitemap and OG metadata were already delivered; this unit added the rest: the page-builder backed product-query landing component (bounded, never invents a price, reports when the catalogue is unavailable), a visual preview of unsaved settings and content that emits the same custom properties as the live head hook, and drag-and-drop ordering with a validated server-side permutation and a numeric no-JavaScript fallback. Block composition (layout template, assigned page slugs, widgets) is now authorable in the admin, which the theme template already consumed. Staging still owns every browser/runtime claim | `docs/independent-rebuild/AUDIT-AND-PARITY-MATRIX.md` §Phase 2, §Source gap |
| A4 | **Node platform — AWS EC2 adapter** | `cloudhost247-node/src/infrastructure/providers/aws-adapter.ts`, profile in `.../providers/configuration.ts` | EC2 create/describe/start/stop/reboot/terminate, snapshots, resize, console output, images, health | Both workflows are now implemented behind an explicit deployment opt-in: reinstall provisions a replacement instance from the target AMI in the same zone/subnet/security groups and only stops the previous instance (never terminates it), and root-volume restore creates a volume from the snapshot in the instance's own zone, stops the instance, detaches the old root (kept, not deleted), attaches the new one at the same device name and restarts only if it was running. Snapshot deletion is implemented. `reinstall` still advertises `false` by default because the capability is deployment-scoped — `AWS_ALLOW_ROOT_VOLUME_REPLACEMENT=true` (or the provider prefix) enables both, and without it every call refuses with `UNSUPPORTED_OPERATION` before a single AWS call. **CloudWatch metrics are now IMPLEMENTED** (2026-10-02): `getServerMetrics` calls `GetMetricStatistics` on namespace `AWS/EC2` with the `InstanceId` dimension, a 300s period (basic-monitoring granularity) and a one-hour window, requesting `CPUUtilization`, `NetworkIn`, `NetworkOut`, `DiskReadOps`, `DiskWriteOps` and `StatusCheckFailed`; a metric with no datapoints is reported in `missing` rather than zero-filled, and no region fails closed with `PROVIDER_NOT_CONFIGURED` before any call. Profile `metrics: true`; new dependency `@aws-sdk/client-cloudwatch`. The only open capability is therefore **rescue** — every lifecycle and root-volume workflow has a real implementation. *(2026-10-02 re-audit: the profile `capabilities` line reads `{ reinstall: false, snapshot: true, resize: true, console: true, metrics: false, rescue: false }`; the phrase "incomplete native adapter" no longer appears anywhere in source — it survives only in this document's earlier wording.)* | `configuration.ts:104-105` (aws profile `capabilities` + `notes`), `aws-adapter.ts:182`, `docs/NODE_PLATFORM_STATUS.md` §"honest template capabilities" |

> **A4 verification (2026-10-02).** AWS `rescue` remains a correct refusal — EC2 has no rescue/recovery-ISO API surface. `metrics` was not a provider limitation at all but an unbuilt integration, and is now built against the documented CloudWatch API.

| A5 | **Node platform — Contabo adapter** | `cloudhost247-node/src/infrastructure/providers/contabo-adapter.ts` | OAuth2 client, create/reinstall/lifecycle, images, snapshots, **rescue** | **CORRECTED 2026-10-02 — the earlier `rescue: false` claim was wrong.** Rescue **is implemented**: `enableRescue` posts `/compute/instances/{id}/actions/rescue`, reusing the template SSH-key secrets or storing a freshly generated one-time password as a Contabo secret (`contabo-adapter.ts:418-454`), and `disableRescue` is a documented no-op because Contabo leaves rescue on the next restart (`:456-459`). The profile declares `rescue: true` (`configuration.ts:129`). The remaining gaps are exactly three: `resize: false`, `console: false`, `metrics: false`. Neither of the two phrases this row used to cite exists in source any more — *"Contabo rescue mode … is not exposed by this adapter"* and *"incomplete native adapter [that] cannot be activated"* return zero hits across `cloudhost247-node/src`. | `configuration.ts:129-130` (contabo `capabilities` + `notes`), `contabo-adapter.ts:418`, `:456` | The advertised refusals are pinned by tests: every profile/adapter that declares `resize`/`console`/`metrics`/`rescue` false is asserted to actually refuse each one with a non-retryable `UNSUPPORTED_OPERATION` before any provider request, so a capability flag can no longer drift away from the implementation (`tests/unit/provider-capability-truth.test.ts` — 6 tests, passing 2026-10-02). One behavioural defect found by that test is fixed: EC2 `enableRescue` threw synchronously instead of rejecting. |

> **A5 verification (2026-10-02).** All three remaining Contabo refusals were checked against Contabo's own API surface and are **correct** — there was no gap to close, so the vague messages were replaced with the verified reason. **resize**: Contabo's only upgrade endpoint, `POST /v1/compute/instances/{id}/upgrade`, is documented as purchasing add-ons ("currently only firewalling and private network addon is allowed"), and `PATCH` changes only the display name; Contabo's own docs state plan upgrades happen "in place via Control Panel". **console**: the generated OpenAPI client's `InstanceActionsApi` lists exactly `rescue`, `resetPassword`, `restart`, `shutdown`, `start`, `stop` — there is no VNC operation, and Contabo documents the VNC console as a Control Panel feature. **metrics**: no metrics endpoint exists; monitoring is a paid Control Panel add-on.
| A6 | **Rescue mode across provider adapters** | `cloudhost247-node/src/infrastructure/providers/*.ts` | **IMPLEMENTED for 6 of 12 adapters** — Hetzner (`enable_rescue` + `reset`), OpenStack (Nova `rescue`/`unrescue`), OVH Public Cloud (`POST .../instance/{id}/rescueMode`), Contabo (`POST /v1/compute/instances/{id}/actions/rescue` with Contabo secret ids; exit is the next restart), the development-only mock, and — **added 2026-10-02 — `generic_http`**, which delegates `POST /v1/servers/{id}/rescue` and `POST /v1/servers/{id}/unrescue` to the operator's bridge on the same action contract it already uses for reboot/shutdown/resize/reinstall. The bridge's own response supplies the rescue system, login user and one-time password; `rebooted` defaults to false so the adapter never claims a reboot it was not told about, and a response naming no rescue system fails with a non-retryable `PROVIDER_ERROR` instead of a fabricated session. | **The other 6 refusals were re-verified against each provider's documented API on 2026-10-02 and are correct, not gaps:** **AWS** has no native rescue mode (manual workflow only). **DigitalOcean**'s Recovery ISO is control-panel only — it is absent from the documented droplet actions, and `doctl` issue #1022 is explicitly blocked on "additional features for the DigitalOcean API". **Vultr** exposes no rescue endpoint in API v2. **Proxmox VE** exposes no rescue endpoint in its API. **Virtualizor** does have rescue (`act=rescue`, `enablerescue`/`disablerescue`) but **only in the enduser API on port 4083** — the Admin API on 4085, which this adapter authenticates against, has no rescue entry, so implementing it would require a credential set the adapter does not hold. **SolusVM 1** exposes no rescue. All six keep `rescue: false` and throw a non-retryable `UNSUPPORTED_OPERATION` before any request. | `providers/common.ts:unsupportedRescue`, `ADAPTER_PROFILES`, `generic-http-adapter.ts:enableRescue`, `tests/unit/provider-rescue.test.ts` (8), `provider-capability-truth.test.ts` (8, incl. 2 new bridge-delegation tests) |
| A7 | **Node deployment adapters** | `cloudhost247-node/src/deployments/adapters/` | Docker/Kubernetes app deployment, cPanel hosting provisioning | **cPanel:** start/stop are the account's suspension state (`suspendacct`/`unsuspendacct`), status reads WHM `accountsummary`, backup/restore use UAPI `Backup::fullbackup_to_homedir` / `list_backups` / `restore_backup` with the archive confined to `/home/<user>/`; `restartApplication` and `applicationLogs` still refuse (cPanel has no per-account restart and the platform cannot read inside an account). **Kubernetes:** real group/version/resource paths, idempotent apply (409 → PUT with the live resourceVersion), replica patch for start/stop with the last count remembered, rollout-restart annotation for restart, status/logs from the Deployment and its Pods, label-discovered teardown; backup/restore return a structured `K8S_BACKUP_REQUIRES_VELERO` refusal because Velero is cluster-side and asynchronous while the platform backup contract needs a retrievable archive. **Docker:** hosting operations return `HOSTING_REQUIRES_CPANEL_ADAPTER`. | The only remaining refusals are the ones with no API behind them, each with its reason in the code and in `docs/NODE_PLATFORM_STATUS.md` (Kubernetes backups/restores, Kubernetes hosting provisioning, cPanel restart/logs) | `tests/unit/deployment-adapter-operations.test.ts` (17), `control-panel-adapters.test.ts` |
| A8 | **Unknown/undeclared provider adapters** | `cloudhost247-node/src/infrastructure/providers/registry.ts`, `configuration.ts`, `src/routes/infrastructure.ts` | — | **CLOSED.** The admin API's accepted adapter list is now derived from `ADAPTER_PROFILES` (`ADAPTER_KINDS`), so a provider row cannot be saved with an adapter that has no implementation. The `UnavailableNativeProviderAdapter` guard remains for rows that predate or bypass the API and now fails with a non-retryable `UNSUPPORTED_OPERATION` naming the kind — previously `SERVICE_UNAVAILABLE`, which the mapper renders as "temporarily unavailable, please try again shortly", a retry that can never succeed. It never borrows another adapter and never falls back to the mock, and an undeclared provider is reported not-ready with every capability false. | The only unreachable refusal left is an unknown *provider kind* arriving by direct database write, which the fallback still fails closed on | `tests/unit/undeclared-adapter-fail-closed.test.ts` (6, all 26 interface methods), `provider-configuration.test.ts` |
| A9 | **External payment webhook pipeline (Phase 5D)** | `cloudhost247-node/src/routes/webhooks.ts`, `src/services/webhook-service.ts`, `src/payments/{stripe,paypal,paystack,sandbox}-gateway.ts`, `cloudhost247-node/database/migrate.ts` | Re-verified: both routes registered with raw-body capture, signature verified before parse/DB, SHA-256 payload hash, 60-second lease with takeover, single transaction — **73/73 integration tests**. **Freeze enforced:** the pipeline is unbuildable-into-production while frozen — every gateway refuses unsigned/unconfigured-secret deliveries (`tests/unit/webhook-secret-fail-closed.test.ts`, 4), and `database/migrate.ts` quarantines 0023/0024/0025/0041 so a production `migrate up` skips standalone frozen artifacts, refuses the whole run (before any DDL) when a dependent migration is pending, and can only be overridden by an explicit per-run `AUTHORIZED_MIGRATIONS` (`tests/integration/migration-quarantine.test.ts`, 8). | **Frozen: NOT EXECUTED IN PRODUCTION — and no longer reversible by a routine deploy.** `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` keeps its stamp *"NOT AUTHORIZED · NOT IMPLEMENTED · NOT DEPLOYED"*; migration 0024 prepared-only; **PR #12 is CLOSED and unmerged** (verified 2026-10-02: `gh pr view 12` returns `state: CLOSED`, `mergedAt: null` — the earlier "remains OPEN" wording is stale; no PRs are open on the repository); no production database touched. Remaining gap: live-gateway verification (real Stripe/PayPal/Paystack credentials) is still NOT PERFORMED, and 0041 blocks production progress past 0040 until separately authorized. | `docs/NODE_PLATFORM_STATUS.md` §A9, §Standing restrictions, §Phase 5D |
| A10 | **Database migrations prepared but never executed** | `cloudhost247-node/database/migrations/` | `0023_enforce_billing_invariants.sql`, `0024_create_webhook_events.sql`, `0025_*`, `0041_*` | Standing restriction: *"Prepared and tested migration artifacts only. **NOT authorized for production execution**"* | `docs/NODE_PLATFORM_STATUS.md` §Standing restrictions |
| A11 | **Node DNS live connectors + route propagation** (`cloudflare`, `route53`) | `cloudhost247-node/src/dns/providers.ts`, `src/dns/propagation.ts`, `src/routes/dns.ts` | **CLOSED 2026-10-02.** Both providers are real implementations, not stubs, **and the customer DNS API now pushes to them.** **Cloudflare** delegates to the existing, separately-tested `src/integrations/cloudflare` package (`CloudflareClient` — auth, timeouts, retry/backoff, envelope validation, secret-free logging — plus `zones.ensureZone` and the `dns.*` record operations), so it opens no second HTTP path to the provider; `createZone` is search-then-create, so a retried run cannot duplicate a zone. **Route53** speaks the real change-batch API via `@aws-sdk/client-route-53` (pinned to 3.1144.0 to match `client-ec2`): it reuses an existing hosted zone for the same name, normalizes the trailing dot, stores the zone id without Route53's leading slash, returns the change id so a caller can tell "submitted" from "propagated", and resolves a platform record id back through `findDnsRecordById` because a Route53 DELETE must echo the record exactly. **`src/dns/propagation.ts` wires all eight mutation points in `src/routes/dns.ts`** (zone create/delete; record create/update/delete on both the direct and nested routes). Propagation runs BEFORE the local write, so the store never claims a resource exists upstream when the upstream call failed; an external zone records the provider's own nameservers and its zone id in `dns_zones.metadata.providerZoneId`, and the auto-seeded NS records are derived from those nameservers instead of hardcoded platform ones. Fail-closed throughout: no credential → `CONFIGURATION_REQUIRED` (503) before any request and **no local row**; a provider that returns no delegation set → 502 and no local row; an external zone with no stored provider zone id → 503 rather than a silent local-only write. Cloudflare refuses `SOA`/`PTR` with `CLOUDFLARE_FEATURE_NOT_SUPPORTED` before any request, because the v4 `dns_records` endpoint does not accept them. INTERNAL zones are untouched by the propagation layer and keep their exact previous behaviour. | — none open | `src/dns/providers.ts`, `src/dns/propagation.ts`, `tests/unit/dns-providers.test.ts` (26), `tests/integration/dns-propagation.test.ts` (9, end-to-end through the real route handlers), `tests/integration/dns-api.test.ts` (4, unchanged and still passing) |

---

## B. Never independently built — vendor, licence-gated, or superseded builds

| # | Module name | Location | Why it counts as unfinished | Evidence |
|---|---|---|---|---|
| B1 | `[retired-addon]` (legacy CloudHost247 theme-helper page builder) — **redacted vendor name; NOT PRESENT IN THIS REPOSITORY** | `modules/addons/[retired-addon]/` *(path does not exist — see note)* | All 63 PHP files were **ionCube-encoded**; *"**Not implemented**"* in the parity matrix. Licence/activation behaviour could not be inspected. **Corrected 2026-10-02:** this addon is **not in the tree and was never committed** — `git log --all --name-only` lists 23 addon directories ever tracked and this is not one of them, and no addon in `modules/addons/` contains `license.php` / `errolicense.php` (the only ionCube-encoded addon present is `xtreme_currency_rates`, 18 files). `[retired-addon]` is a documentation redaction (`docs/independent-rebuild/BRAND-RENAME.md`) for a vendor bundle that existed in the pre-restructuring source tree but was never committed here. The claim that *"the vendor block manager still decides whether the pinned root pages render content"* is also stale — see §D: every root route now renders the independent theme content store and touches no vendor tables or vendor shell. Listed because the parity matrix still scores it "Not implemented", not because there is code here to finish | `docs/independent-rebuild/AUDIT-AND-PARITY-MATRIX.md` row 1 + line 35, `docs/pre-restructuring-audit.md` line 21, `git log --all --name-only` |
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
| C12 | ~~`cloudhost247-node/frontend/src/components/Placeholder.tsx`~~ — **DELETED, no longer a stub in the tree** | gone | The Phase-1 "route is part of the routing foundation … feature will be implemented in a later phase" scaffold. **Corrected 2026-10-02:** the file **does not exist** — `ls` fails on the path, no `import` of it remains in `cloudhost247-node/frontend/src`, and `git log --all --name-only` returns **0** occurrences of `components/Placeholder.tsx`, i.e. it is not in the working tree and never was in this repository's history. Retained as a struck-through row only so the earlier inventory's numbering stays stable; it should be dropped from any "unfinished" count |
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

**In-build Node adapters/modules:** `aws` (reinstall gated, metrics, rescue) · `contabo` (resize,
console, metrics) · `cpanel-adapter` *(restartApplication / applicationLogs are deliberate refusals,
not gaps)* · `UnavailableNativeProviderAdapter` · webhook pipeline (frozen) · migrations `0023`,
`0024`, `0025`, `0041`

**Never independently built (vendor/gated/superseded):** ~~`[retired-addon]`~~ *(not in this repository —
never committed; documentation-only)* · `xtreme_currency_rates` · `soyoustart` (addon) · `soyoustart` (server) ·
`soyoustart_vps` · `ovh_cart` · vendor crons `getServer.php` / `getIpStatus.php` / `priceSync.php` / `emailSend.php` ·
`Smtphosting` · `cloudhost247_email` (inactive) · `smmaddon` + `smmprovisioning` (prototype)

**Stubs / zero-byte:** 6 × `Smtphosting` placeholder files · `clientareacreditcard.tpl` ·
`creditcard.tpl` · `pwreset.tpl` · `override.css`(+`.new`) · `override.js`(+`.new`)
*(13 zero-byte files total, verified by `find . -type f -empty`; ~~`Placeholder.tsx`~~ no longer exists)*

**Rescue mode — implemented for 6:** `hetzner` · `openstack` · `ovh` · `contabo` · `mock` ·
`generic_http` (bridge delegation, added 2026-10-02)

**Rescue mode — the 6 that still refuse it, each re-verified against its provider's documented API:**
`aws` (no native rescue) · `digitalocean` (Recovery ISO is control-panel only) · `vultr` (no v2
endpoint) · `proxmox` (no API endpoint) · `virtualizor` (rescue is enduser-API/4083 only; this
adapter uses the Admin API/4085)
  - **CORRECTED 2026-10-02 — `solusvm` is now IMPLEMENTED, not refused.** The claim that
    SolusVM 1's Admin API v1 has no rescue action was false: `action=vserver-rescue` with
    `rescueenable` (1 = 4.x 64-bit, 2 = 3.x 64-bit, 3 = 3.x 32-bit) or `rescuedisable` is
    documented on the same `api/admin/command.php` endpoint the adapter already uses, returning
    `{status, statusmsg, password, user, port, ip}`. `enableRescue`/`disableRescue` now call it,
    report `rebooted: true` (enabling rescue reboots the VPS — SolusVM states this explicitly),
    carry the returned ip/port into `notes`, and refuse arm64 rather than booting an x86 rescue
    kernel into it. Profile `rescue: true`; 4 new tests pin the form body and the refusals.
