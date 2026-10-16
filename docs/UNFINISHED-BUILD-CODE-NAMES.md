# Unfinished build code — name list

**Scope:** every module/build artifact in this repository whose code is *not finished and verified*.
**Compiled:** 2026-10-05. **Re-verified the same day against `cf576ca`** — the tip of
`arena/01a10cfb-cloudhost247`, which this checkout holds as a single squashed commit. The earlier
provenance line named `HEAD 3ee7e21` on `arena/01a10c4a-cloudhost247`; that commit is not reachable
from this history, so every claim below was re-checked against the tree rather than trusted from the
header. Four corrections came out of that pass and are dated where they appear: the marker count (16
domain modules, not 17), the three misattributed rows in §1a, and the `infrastructure.js` closure
recorded as row 7 of the progress log.
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
| 3 | `platform/` quick wins — TOTP enrolment QR image; `scripts/rehash-passwords.js` | **DONE 2026-10-05** — see §1b. QR matrices are byte-identical to python-qrcode and the API's PNG was decoded back by OpenCV; the rehash tool only ever invites a reset, because a bcrypt hash cannot be verified or transposed |
| 4 | `platform/spa/` commerce and billing — cart, checkout, invoices, payments, services, domains | **DONE 2026-10-05 (server + client verified end-to-end; no browser has rendered the pages)** — see §1b. Two server-side blockers were fixed on the way: cart lines carried no plan names, and plan changes demanded a plan UUID that no public endpoint reveals |
| 5 | `platform/spa/` admin console — staff-gated shell, dashboard counts, customer directory/detail, service + domain records, ticket queue, staff directory, "switch to customer" delegation | **DONE 2026-10-05 (server + client verified end-to-end; no browser has rendered the pages)** — see §1b. Delegation parks the admin's credentials so the delegated token is never refreshable, and the role boundaries are the server's own (a staff account is refused on status/role/switch/directory; a super admin cannot change their own role) |
| 6 | `platform/src/lib/providers/` — infrastructure provider egress (`provider-adapters.js`) | **DONE 2026-10-05: all 12 kinds ported, no live provider call made from this environment** — `hetzner`, `digitalocean`, `vultr`, `aws` (EC2 query protocol + SigV4), `contabo`, `ovh`, `proxmox`, `virtualizor`, `solusvm`, `openstack`, `generic_http` (operator bridge) and the development-only `mock`. 37 tests: the published AWS SigV4 vectors, per-adapter wire contracts over real loopback HTTP, idempotency, capability refusals, error classification and the sanitizer. Provider-side acceptance of every request is unverified — no credentials exist here and no provider was contacted. See §1a |
| 7 | `platform/src/domains/infrastructure.js` — wiring the ported adapters into the domain, so a route performs provider egress | **DONE 2026-10-05 (loopback-verified; no real provider contacted)** — see §1a. New `platform/src/lib/provider-egress.js` is now the only place a domain may build an adapter, and it enforces three rules: fail closed before egress (naming the missing variables), never fake a result, and never return the provider's own message to a browser. Three endpoints now talk to a provider inside the request: provider diagnostics, OS image verification and server reconciliation. 14 tests drive the real routes over the real HTTP pipeline against a loopback provider API, and all five behaviours were mutation-verified (reverting image verification to unconditional stamping turns 4 red, a diagnostics route that never calls the provider turns 3 red, returning the raw provider message turns 2 red, dropping reconciliation egress turns 5 red, auto-applying a provider status turns 3 red) |
| 8 | `platform/src/domains/servers.js` — hypervisor/provider actions and the live console session | **DONE 2026-10-05 (loopback-verified; no real provider contacted)** — see §1a. The console route issues a real provider session instead of a random token that led nowhere, normalized through an explicit field whitelist so a future adapter cannot leak an unexpected field into a browser. Every lifecycle action now passes one capability gate in `queueAction`, so a provider that documents no rescue system refuses with a 400 naming the provider and capability instead of returning `202` and a job that could only fail. Two real defects were closed on the way: a refused rescue used to leave the server row saying `rescue` when nothing had been asked of any provider (the status write now happens *after* the job is accepted), and the audit log records the *shape* of a console session rather than its contents. The gate reuses the adapter's own `replacementEnabled` predicate for EC2's deployment-scoped `reinstall`, so it cannot drift from the adapter — pinned by a test that flips `AWS_ALLOW_ROOT_VOLUME_REPLACEMENT`. 12 tests; **all seven mutations caught** (deferred console token restored → 4 red, audit storing the whole session → 2 red, gate removed → 3 red, rescue status written before the job → 2 red, console pre-check removed → 2 red, gate ignoring the deployment opt-in → 1 red, whitelist replaced by a pass-through spread → 2 red) |
| 9 | `platform/src/domains/provisioning.js` — provider-side build execution (the worker that runs the queued jobs) | **DONE 2026-10-05 (loopback-verified; no real provider contacted)** — see §1a. New `platform/src/lib/provisioning-worker.js` executes every queued kind against the provider that owns the machine, exposed as one cycle per request so it can be driven by cron, an operator or a test. Four properties hold and are pinned: creation is idempotent on the job id, so a crash between the provider call and the local write cannot allocate a second billable machine; `ProviderError.retryable` decides between re-queueing with backoff and dead-lettering at three attempts; a rescue password goes to the write-only `server_credentials` table and is redacted from `job.result`, which the admin API returns; and an unknown job kind fails by name instead of going green. Two real defects were found by the tests rather than by reading: a job that failed retryably was re-queued and then immediately re-claimed by the same cycle, burning all three attempts with no backoff; and attempts were double-counted, dead-lettering one attempt early. The capability map is now single-sourced between the queue-time gate in `servers.js` and the worker, so they cannot drift. 11 tests; **all ten mutations caught** (random idempotency key → 2 red, unsanitized job result → 2, rescue password discarded → 2, unknown kind marked complete → 2, retryable dead-lettered at once → 2, same-cycle re-claim → 2, double-counted attempts → 2, reconcile failing the backlog → 2, unverified image provisioned → 2, CREATE not writing the handle back → 3) |
| 10 | `platform/src/domains/operating-systems.js` — provider mapping filter (what a customer can actually order) | **DONE 2026-10-05** — see §1a. New `platform/src/lib/os-availability.js` resolves each OS version through `server_product_configurations` → `regions` → `infra_providers` → `os_images` and answers with `orderable` plus exactly one reason in reporting order: `NO_CONFIGURATION`, `CONFIGURATION_DISABLED`, `ARCHITECTURE_UNSUPPORTED`, `NO_IMAGE`, `IMAGE_UNVERIFIED`. `GET /api/v1/operating-systems/:id/versions` now returns only buildable versions, each carrying its `availability` block, with a `hidden` count so the UI can say how much it withheld; staff may pass `?includeUnavailable=true` (403 for a customer). `GET /api/v1/operating-systems` drops any OS with no orderable version and reports `orderableVersions`. Reads four tables once and evaluates in memory, so the list route is not quadratic. No frontend or SPA consumer reads either route, so the response shape changed freely. **This closed a live defect in row 9 rather than only adding a filter:** the worker's `imageFor` matched `os_images` on `os_id` alone, so a server ordered as 22.04 could be built from a verified 24.04 mapping — a machine running the wrong release, from a mapping that had passed verification. The version is now part of the join in both the catalogue and the worker, and the worker refuses outright when `servers.os` is unrecorded and more than one version is mapped instead of guessing. 8 new subtests plus a worker subtest pinning the wrong-version refusal, the unmapped-version refusal and the ambiguity refusal; **all six mutations caught** (availability ignoring the image version → 5 red, worker ignoring `server.os` → 2, worker guessing when ambiguous → 2, versions route not filtering → 3, `includeUnavailable` not staff-gated → 2, OS list not filtering → 2) |
| 11 | `platform/src/domains/monitoring.js` & agent telemetry — signed HMAC agent telemetry ingestion (wire-compatible with server-agent and cloudhost247-node) + server metrics API | **DONE 2026-10-06** — see §1a. Mutual HMAC-SHA256 request authentication implemented in `platform/src/lib/agent-auth.js` (per-server `agent_secret`, timestamp skew <=60s, CSPRNG nonce replay cache). Ingests raw MB/load telemetry, converts to percentages, writes to `server_metrics` and updates `server.metadata.agent_last_seen_at`. Monitoring endpoint evaluates dynamic saturation thresholds (>95% -> DEGRADED), and provides direct server telemetry POST endpoint. 11/11 tests green. |
| 12 | `platform/src/domains/tools.js` — live DNS resolver (`node:dns/promises`) + outbound HTTP monitor probes with SSRF protection | **DONE 2026-10-06** — see §1a. Live DNS lookup supports A, AAAA, CNAME, MX, NS, TXT, SOA, PTR, and SRV records with TTL and structured answer summaries. HTTP uptime monitors execute real HTTP/HTTPS probes with latency measurement, status codes, and SSRF loopback/private IP blocking. 6/6 tests green. |
| 13 | `platform/src/domains/deployments.js` — CI/CD execution pipeline & deployment worker | **DONE 2026-10-06** — see §1a. Implemented `platform/src/lib/deployment-worker.js` with 5-step ordered execution pipeline (Validate, Resolve Source & Manifest, Prepare Build, Deploy Services, Health Check), lease expiration & worker claiming, `deployment_steps` transition recording, `deployment_events` log streaming, linked `application_installation` status transitions, `POST /deployments/:id/execute`, and admin sweep `POST /admin/deployments/sweep`. 6/6 tests green. |
| 14 | `platform/src/domains/app-installations.js` & `platform/src/domains/services.js` — Paid-order provisioning pipeline & worker, deployment log streaming, customer services server provisioning linkage | **DONE 2026-10-06** — see §1a. Implemented `platform/src/lib/order-provisioning.js` (`provisionPaidOrder` & `sweepPaidOrders`), wired into `billing-apply.js` settlement hook so paid orders automatically enqueue and execute install deployments to running/healthy. Free app installations (price 0) auto-provision immediately. Deployment log streaming reads real events from `deployment_events`. Lifecycle actions (`start`, `stop`, etc.) execute deployments and update installation status. Customer services provision action triggers server `provisioning_jobs` and updates to active on completion. 7/7 tests green. |
| 15 | `platform/src/domains/dns.js` & `platform/src/domains/ssl.js` — RFC 1035 zone file export, live resolver check, ACME challenge generation and X.509 validity handling | **DONE 2026-10-06** — see §1a. Implemented RFC 1035 BIND zone export (`GET /dns/zones/:id/export`) and live DNS resolver propagation validation (`POST /dns/zones/:id/records/:recordId/check`) using `tools-connectors.js`. SSL supports ACME HTTP-01/DNS-01 challenge generation (`GET /ssl/certificates/:id/challenge`), native `crypto.X509Certificate` validity parsing, and 90-day renewal cycle. All tests green. |
| 16 | `platform/spa/` customer DNS screen — `DnsPage.jsx` + `dnsApi` (§1.2 named gap) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `e5fd4ffe`. Zone and record CRUD against the customer `/dns` API, RFC 1035 zone file export, and live propagation checks rendered honestly (match / differs / not resolvable yet). Contract test `tests/spa-dns-screen.test.js` walks the screen's exact HTTP sequence over the real app and pins the page source to the response keys it renders, including the MX/SRV priority rule the form enforces. |
| 17 | `platform/spa/` customer Cloudflare screens — `CloudflareServicesPage.jsx`, `CloudflareServicePage.jsx` + `cloudflareApi` (§1.2 named gap) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `e5fd4ffe`. Services list plus a tabbed zone screen covering every customer `/cloudflare` surface: overview + nameservers, DNS (cached reads labelled with `lastSyncedAt`, live writes), SSL/TLS, firewall (settings + access rules), speed, caching + purge, scrape shield, DNSSEC, analytics, plan change, activity. Tabs are gated on plan entitlements so a free-tier service shows its real refusals instead of dead buttons; the DNSSEC tab renders the API's 404-not-enabled answer as an off state. Contract test `tests/spa-cloudflare-screen.test.js` walks the sequence against `fixtures/fake-cloudflare` bound per account (writes really reach the fake), asserts the free-tier firewall refusal, and pins the screen sources to the response keys. |
| 18 | `platform/spa/` marketplace + My Apps screens — `MarketplacePage.jsx`, `MyAppsPage.jsx` + `marketplaceApi`/`appsApi` (§1.2 named gap) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `e5fd4ffe`. Category/search browse of the admin catalogue, install with name/domain/backup options (the payment-required path reports the real invoice number and amount), installations list with lifecycle actions (start/stop/restart/update/reinstall) and uninstall. Contract test `tests/spa-marketplace-screen.test.js` seeds a catalogue, walks free + paid installs and pins the screens to the response keys. |
| 19 | `platform/spa/` server inventory + server detail screens — `ServersPage.jsx`, `ServerDetailPage.jsx` + `serversApi` (§1.2 named gap: "server detail") | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `e5fd4ffe`. Inventory + create, and a detail screen whose every lifecycle control reports the queued job id (power, snapshots, resize, reinstall, rescue) rather than a pretended result; console requests a real provider session or shows the named refusal; health card, provisioning log, cancellation round trip. Contract test `tests/spa-servers-screen.test.js` walks the sequence over the real app (including the console refusal with no provider configured) and pins the screen sources to the response keys. |
| 20 | `platform/spa/` admin billing console — `AdminBillingPage.jsx`, `AdminInvoiceDetailPage.jsx`, `AdminLedgerPage.jsx` (§1.2 admin groups: billing/ledger) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `12c1a417`. Invoices with status filter, the ledger-derived money position per currency (other currencies never folded into the USD figures), invoice detail with line items/ledger/payment attempts, manual-payment confirm and reject (reason mandatory), refund of captured payments, void-with-reason. Contract test `tests/spa-admin-billing-screen.test.js` drives real orders through the cart and walks the screens' exact sequence, including the `invoiceNumber`-vs-`number` DTO split and the staff gate. |
| 21 | `platform/spa/` admin orders console — `AdminOrdersPage.jsx`, `AdminOrderDetailPage.jsx` (§1.2 admin groups: orders) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `12c1a417`. Store-side status/reference filters; per-row invoice and payment position; detail with items, billing block, fulfilment (installations, services, provisioning jobs) and the server's own cancellation guards rendered verbatim — a settled order names the refund path instead of offering a dead button. Contract test `tests/spa-admin-orders-screen.test.js` walks the sequence and asserts the settled-order honesty contract (refusal + refundPath). |
| 22 | `platform/spa/` admin domain-services console — `AdminDomainServicesPage.jsx` (§1.2 admin groups: domain services) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `12c1a417`. Tabbed console covering the whole `admin-domain-services.js` surface: overview counts, provider registration against the compiled adapter registry, write-only credentials (a test asserts no credential value is ever returned), Test Connection as a real call to the loopback registrar fake (verdict + `connected` gate), extensions list/sync/patch, transfers list/patch/refresh-poll, registrations, auctions (create/actions), club plans, and the appraisals/WHOIS/transactions oversight lists. Super-admin mutation gates enforced by the server and mirrored in the screen. Contract test `tests/spa-admin-ds-screen.test.js` walks the exact sequence against `fixtures/fake-registrar` and pins the page source to the response keys. |
| 23 | `platform/spa/` admin marketplace console — `AdminMarketplacePage.jsx` (§1.2 admin groups: marketplace admin) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `7af86abe`. Four tabs: Catalogue (create draft apps, WORKFLOW_TRANSITIONS enforced with illegal moves refused and the "publish needs a published version" error rendered verbatim, version patch with isStable demoting siblings, delete with the "mark it deprecated instead" install-count contract), Public Listing (active flag/price/version), Categories (create/patch), Manifests (validate/import/seed-categories with the returned slug counts). Contract test `tests/spa-admin-marketplace-screen.test.js` walks the exact sequence against a real imported manifest and pins the page source to the response keys. |
| 24 | `platform/spa/` admin provisioning console — `AdminProvisioningPage.jsx` (§1.2 admin groups: provisioning) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `7af86abe`. Queue with status filter and detail (steps/events), metrics card, one worker cycle and reconcile — the exact routes a scheduler hits (`/admin/provisioning/worker/run`, `/admin/provisioning/reconcile`) — and retry (failed-only) / cancel (queued-only) / force-cancel with the server's guard refusals shown verbatim. Contract test `tests/spa-admin-provisioning-screen.test.js` drives a real queued job from the customer server-create flow through the guards and cycle. |
| 25 | `platform/spa/` admin monitoring console — `AdminMonitoringPage.jsx` (§1.2 admin groups: monitoring) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `7af86abe`. Fleet server-health table from `GET /admin/monitoring/server-health` (latest telemetry per server; missing metrics render as "no datapoints", never a zero) with drill-in to the monitoring record (healthStatus, current metrics, services, containers, agent last-seen). Contract test `tests/spa-admin-monitoring-screen.test.js` posts real telemetry through the agent endpoint and pins the page source to the response keys. |
| 26 | `platform/spa/` admin deployments console — `AdminDeploymentsPage.jsx` (§1.2 admin groups: deployments) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `7af86abe`. Queue with status/action filters, detail with ordered step pipeline and event log, queued-only Execute/Cancel (the server's `Only queued deployments can be cancelled` refusal rendered verbatim), and the deployment worker cycle (`POST /admin/deployments/sweep`). Honours the server's owner-scoped `canSeeDeployment` contract: staff see every deployment in the queue, detail is requester-scoped, and the screen surfaces the 404 honestly rather than inventing a privilege. Contract test `tests/spa-admin-deployments-screen.test.js` pins both the manage path and the visibility contract. |
| 27 | `platform/spa/` admin OS registry / image mappings / server templates — `AdminOsVersionsPage.jsx`, `AdminOsImagesPage.jsx`, `AdminAvailabilityPage.jsx` (§1.2 admin groups: OS images/versions/availability) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `96092dae`. Three screens over `operating-systems.js` + `infrastructure.js`: OS registry and version lifecycle (mapping counts, activation refused while the OS is archived — verbatim, archive-before-delete guard), provider image mappings (Test records the adapter's real verdict: a configured adapter that answers stamps verification, an unreachable one records its reason and never stamps; disable-before-delete guard; the stale-verification panel), and server templates (created disabled — the server refuses `ACTIVE` on create; enable is gated on active references plus a verified image for the exact combination, refusals named verbatim; adapter capability panel reports what each provider really supports). One backward-compatible backend enrichment: `GET/POST /admin/os-images` now return the full `imageDto` (region, verification state) instead of a 4-field projection, so the screen shows each row's real state. Contract test `tests/spa-admin-os-screens.test.js` drives both verdict paths (platform mock adapter behind `ALLOW_MOCK_PROVIDER=true`, plus an unconfigured Hetzner) and the enable gate in both directions. |
| 28 | `platform/spa/` admin AI support + free-tools consoles — `AdminAiSupportPage.jsx`, `AdminToolsPage.jsx` (§1.2 admin groups: AI/tools) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `c3c8ed3b`. AI support: overview (AI/human handled, escalations by reason, newsletter actives), conversations with the server's status enum + search, detail showing the assistant's own `intent`/`confidence`/`knowledge_sources` on every answer, agent reply (closed conversations refused by name), status/priority/assignment management including the return-to-assistant hand-back, presence/capacity, agents panel, the code-owned answer catalogue (read-only — the API's `editable:false` and review note are rendered, nothing pretends it can edit), newsletter subscriptions. Free tools: cross-user report and monitor moderation (delete reports), MRZ tool settings with the mandatory privacy protections shown as locked — the server's `Privacy protections for the MRZ tool are mandatory and cannot be disabled` refusal is exercised and rendered verbatim. Contract test `tests/spa-admin-ai-tools-screen.test.js` seeds a real conversation through the public widget API and walks every screen sequence, pinning the filter dropdown to the server's status enum (the legacy `'open'` widget status is never sent by the screen). |
| 29 | `platform/spa/` security-number policy console — `AdminSecurityNumberPage.jsx` (§1.2 admin groups: security-number policy) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `f5c7ec48`. Policy card (rotation window, step-up requirement, verification attempts/window, reveal TTL, support-session minutes) with super-admin-only writes and the server's empty-update `At least one setting must be provided` refusal; per-user lifecycle oversight (initialized, re-initialization required, version, created/expires) that renders **metadata only** — the screen and the API both state the value and its hash are never returned; force-rotate (the new value is hashed and discarded server-side, retrieved by the customer's own step-up reveal) and super-admin-only require-re-initialization. Contract test `tests/spa-admin-security-number-screen.test.js` pins the role split (admin can rotate, only super_admin writes policy/forces re-init), the no-hash/no-value contract, and the version bump. |
| 30 | `platform/spa/` audit-log console — `AdminAuditLogPage.jsx` (§1.2 admin groups: audit log) | **DONE 2026-10-16 (server + client verified end-to-end; no browser has rendered the pages)** — commit `d90a5c97`. Read-only console over the append-only log: actor join (email/name), resource type/id and case-insensitive action-substring filters, limit/offset pagination with the untruncated match count, recorded metadata rendered as JSON. Honours the two views' role split exactly: the full `/api/v1/audit-logs` contract is admin+, the narrower `/api/v1/admin/audit-logs` staff view exists for the staff role, and both refuse customers. Contract test `tests/spa-admin-audit-log-screen.test.js` generates real audit rows through the security-number console actions and walks every filter and page the screen issues. |
| 31 | Platform scheduler / cron wiring (§7 scheduling gap) — `platform/src/lib/scheduler.js`, `platform/src/worker/cron.js` | **DONE 2026-10-16** — commit `27e279ef`. The sweeps existed as admin-only routes that ran on operator action; one scheduler tick now drives them all: the provisioning worker cycle, the deployment cycle, the paid-order/app-installation sweep, and the transfer-refresh poll over every in-flight domain transfer (the platform equivalent of the audited Node build's `worker/` sweeps and this repo's `crons/` scripts). `npm run cron` is the crontab entry point — boots the real app, runs one tick, prints the JSON report, exits 1 only if a sweep itself failed. One broken sweep never stops the others (failures are named in the report); a registrar that cannot be reached counts as a failed poll and leaves the transfer's status untouched, because a poll that could not run proves nothing. Contract test `tests/scheduler.test.js` drives one tick over real queued jobs, a queued deployment, a paid order and two transfers against `fixtures/fake-registrar` (plus one that cannot resolve a registrar), isolates a broken sweep, and runs the actual CLI as a child process. Deployments note: schedule `npm run cron` in the system crontab (a one-minute line is safe — every cycle underneath is claim/CAS idempotent). |
| 32 | `platform/mobile/` Capacitor shell — `src/mobile-boot.js`, `src/index.js`, `spa/src/lib/api.js` API-origin contract, `spa/src/main.jsx` wiring (§1.3) | **DONE 2026-10-16 (server + client verified end-to-end; no device build has run)** — commit `1f537e18`. The shell wraps the same SPA bundle (`webDir` → `../spa/dist`); the app code is the native bootstrap: API-origin configuration for local-assets shells (`plugins.CloudHost247.apiOrigin` → `window.__CH247_API_ORIGIN__` → `resolveApiOrigin`/`apiUrl`, https required except loopback, invalid origins refused rather than half-working), splash hide, status bar from the config block, Android back button (history back, minimise at root), platform marker, HashRouter natively vs `BrowserRouter` `/app` on the web, service worker gated off the native shell. Every native call is guarded through `window.Capacitor.Plugins` and is a no-op with the plugin missing — nothing is invented. A local-assets shell with no API origin warns by name; a hosted shell (`server.url`) needs none. Contract test `tests/mobile-shell.test.js` (5 tests) executes the real ES modules against injected fakes and pins the config/package/wiring contracts. `android/`/`ios/` remain `cap add`-generated and gitignored by design. **Not verified here:** `cap add`, Gradle/Xcode builds and on-device behaviour (no Android SDK/Xcode in this environment) — see `platform/mobile/README.md`. |

---

## 1. `platform/` — the newest build (added 2026-10-05) — largest unfinished surface

41 domains exist and its 671 tests pass, but **6 domain modules still ship explicit `deferred` markers** for the
live integration side (`grep -rl deferred platform/src/domains` = 6 files; 9 under `platform/src` counting
`lib/provider-adapters.js`, `lib/provider-egress.js` and `store/schema.js`).

> **Caveat on that grep, found while closing row 8.** `grep -rl deferred` counts any *mention*, and a
> closing comment that quotes the old placeholder wording keeps its file on the list after the
> deferral is gone — `servers.js` did exactly that. The word was reworded so the count means what the
> audit says it means. When a module is closed, check that it actually leaves this list; if it does
> not, either the deferral is still there or the prose is.
An earlier revision of this document said 17 and listed `provisioning.js`, `marketplace.js` and
`marketplace-admin.js` in the same table — **corrected 2026-10-05** on two counts: none of those three
ever contained the marker (`provisioning.js` defers in substance, "no live workers here"; the two
marketplace modules carry no deferral note at all), and `infrastructure.js` was 16th until its three
deferrals were closed in progress-log row 7, which removed the word from that file entirely. The
provider egress layer was closed on 2026-10-05 — see §1a — and the frontend is a fraction of the old
one.

### 1a. Modules whose live integration is deferred (code present, egress missing)

| Module | What is deferred |
|---|---|
| `platform/src/lib/provider-adapters.js` | **Closed 2026-10-05** — `platform/src/lib/providers/` now implements real egress for **all 12 kinds** (the last three: `aws` — EC2 query protocol with this build's own SigV4 signer, verified against the published AWS test-suite vectors; `contabo` — OAuth2 password grant with an in-memory token; `openstack` — Keystone password or static-token login with service-catalog resolution). The configuration registry reports per-kind implementation readiness; nothing in the domain layer calls the layer yet |
| `platform/src/domains/infrastructure.js` | **Closed 2026-10-05 — the first three deferred behaviours are real provider egress**, through the new `platform/src/lib/provider-egress.js`: provider diagnostics inside a request (`POST /admin/providers/:id/test` calls `validateConfiguration`), image verification (`POST /admin/os-images/:id/test` asks the provider and only stamps `verified_at` on a real answer, including the provider's availability flag and an architecture cross-check) and reconciliation (`POST /admin/server-reconciliation/sweep` calls `healthCheck` per server and reports `PROVIDER_STATUS_MISMATCH` / `PROVIDER_MISSING`). **Still open here:** nothing *writes* provider state from this domain (no create/resize/snapshot path), and servers this platform holds no provider handle for are still reconciled against local records only — the response now says how many were really compared (`reconciled.providerChecked` vs `localOnly`) so a sweep cannot under-report what it skipped. No call has been made to a real provider account |
| `platform/src/domains/servers.js` | **Closed 2026-10-05 — the console is a real provider session and actions are gated on what the provider performs.** `POST /servers/:id/console` calls `getConsole` and returns a normalized session (Hetzner's `wss_url` + one-time password, Vultr's `kvm` URL, EC2's generated key pair) through an explicit field whitelist, and the audit row records only the shape of the session — never the credential, since the EC2 private key exists nowhere else. Every lifecycle action is gated in the single `queueAction` choke point, so a route cannot forget it. **Still open:** the queued jobs are still not executed — that is `provisioning.js` — and a server this platform holds no provider handle for is deliberately still queued rather than refused, because it may legitimately be mid-provision |
| `platform/src/domains/provisioning.js` | **Closed 2026-10-05 — the worker exists** (`platform/src/lib/provisioning-worker.js`), and the module's own words *"no live workers here"* are gone. Every queued kind now executes against the provider: `CREATE` (idempotent on the job id, writes the provider handle and IP back onto the server row), `START`/`STOP`/`SHUTDOWN`/`REBOOT`, `DELETE`, `RESIZE`, `SNAPSHOT_CREATE`/`DELETE`/`RESTORE`, `REINSTALL`, `REBUILD`, `RESCUE_ENABLE`/`DISABLE`. Reconciliation now fails a job only when the worker's own lease rule agrees nobody is running it, and leaves a queued job alone as backlog. **Still open:** one attempt per job per cycle with no scheduled timer — a deployment must run the cycle from cron — and the claim is a single-writer guarantee within one process, because the store abstraction exposes no `SELECT … FOR UPDATE` |
| `platform/src/domains/operating-systems.js` | **Closed 2026-10-05 — the catalogue offers only what can be built** (`platform/src/lib/os-availability.js`), and the reason a version is withheld is reported rather than implied by absence. |
| `platform/src/domains/monitoring.js` | **Closed 2026-10-06 — Agent telemetry ingestion & verification completed** (`platform/src/lib/agent-auth.js`). Authenticates inbound server agent telemetry via per-server HMAC-SHA256 signatures over agentId, timestamp, nonce, method, path, and body hash; rejects replay nonces and timestamp skews > 60s; converts raw telemetry into `server_metrics` percentages; tracks agent last seen timestamps; evaluates saturation health status (>95% -> DEGRADED); and exposes `POST /api/v1/monitoring/servers/:id/metrics`. 11 tests in `platform/tests/monitoring-telemetry.test.js` |
| `platform/src/domains/deployments.js` | **Closed 2026-10-06 — CI/CD execution pipeline and worker completed** (`platform/src/lib/deployment-worker.js`). Executes queued deployments through ordered steps in `deployment_steps` with timing and output; emits streaming events to `deployment_events`; transitions linked `application_installations` to running and healthy; provides `POST /deployments/:id/execute` and `POST /admin/deployments/sweep`. 6 tests in `platform/tests/deployment-execution.test.js` |
| `platform/src/domains/app-installations.js` | **Closed 2026-10-06 — Paid-order provisioning worker, deployment log streaming completed** (`platform/src/lib/order-provisioning.js`). Free apps auto-provision on create; paid apps deploy on payment settlement via `billing-apply` hook; deployment logs stream structured events from `deployment_events`; lifecycle actions execute deployments; `POST /admin/app-installations/sweep` sweeps pending paid orders. 7 tests in `platform/tests/app-installations-services.test.js` |
| `platform/src/domains/services.js` | **Closed 2026-10-06 — Provisioning worker linkage completed**. `POST /services/:id/provision` enqueues CREATE jobs in `provisioning_jobs` for associated servers, and `provisioning-worker` marks linked services active upon completion. |
| ~~`platform/src/domains/marketplace.js`, `marketplace-admin.js`~~ | **Row removed 2026-10-05 — it was wrong.** Both are catalogue surfaces only: `marketplace.js` is public browsing (its sole mention of installing is the header comment "auth required for install") and `marketplace-admin.js` is admin CRUD over categories, applications and versions. Neither contains a deploy route, a worker reference or a `deferred` marker. One-click deploy execution lives in `app-installations.js` (paid-order provisioning hook, deployment log streaming) and `deployments.js` (CI/CD execution), both already listed above |
| `platform/src/domains/dns.js` | **Closed 2026-10-06 — RFC 1035 zone file export and live resolver validation completed**. Records stored authoritatively with standard zone file export (`GET /dns/zones/:id/export`) and live DNS query propagation validation (`POST /dns/zones/:id/records/:recordId/check`) via `tools-connectors.js`. 1 test in `platform/tests/dns-export-check.test.js` |
| `platform/src/domains/ssl.js` | **Closed 2026-10-06 — ACME challenge generation & native X.509 certificate handling completed**. Supports ACME HTTP-01 and DNS-01 challenge token issuance (`GET /ssl/certificates/:id/challenge`), native `crypto.X509Certificate` validity parsing, and 90-day renewal cycle. 11 tests in `platform/tests/ssl.test.js` |
| `platform/src/domains/cloudflare.js`, `admin-cloudflare.js` | Live Cloudflare client, "Test Connection", live purge |
| `platform/src/domains/domain-services.js` | Availability / WHOIS-RDAP / appraisal provider connector |
| `platform/src/domains/admin-domain-services.js` | Registrar transfer refresh poll |
| `platform/src/domains/ai-os.js` | **Closed 2026-10-08** — Copilot completed as a deterministic intent router over real rows: `platform/src/lib/ai-copilot.js` (14 admin + 9 customer commands) and `platform/src/lib/ai-copilot-data.js` (19 queries), wired to `POST /admin/ai/copilot` and `POST /account/ai/assistant`. Answers carry `evidence` (query + row count); unmatched prompts return the supported list with `confidence:'none'`; failures say what failed and state that nothing was fabricated. No model adapter is required and none is simulated. 6 tests in `platform/tests/ai-copilot.test.js` |
| `platform/src/domains/ai-support.js` | **Closed 2026-10-08** — the support assistant is a deterministic operator (`platform/src/lib/support-operator.js`, ported from the audited build's `ai/knowledge.ts` + `ai-support-operator.ts`): 17 reviewed catalogue answers with keyword retrieval, published prices read from real catalog rows, a newsletter form request, and escalation for everything else. Escalation writes a real `support_tickets` row for a signed-in customer, assigns/notifies an available agent, and sets priority + department from the reason; assistant messages record `intent`/`confidence`/`knowledge_sources`. No model is simulated — every answer is labelled `engine: 'deterministic-retrieval'`. 6 tests in `platform/tests/support-operator.test.js` |
| `platform/src/domains/tools.js` | **Closed 2026-10-06 — Live DNS resolver & HTTP monitor probe connectors completed** (`platform/src/lib/tools-connectors.js`). Real DNS queries executed via `node:dns/promises` across 9 record types; outbound HTTP monitor probes execute real GET/HEAD requests with latency timing, status code capture, and SSRF protection (private IP / blocked hostnames). 6 tests in `platform/tests/tools-connectors.test.js` |

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
- ~~**TOTP QR enrolment image** — secret + `otpauth://` URI returned; QR/PNG encoder not written.~~
  **Closed 2026-10-05:** `platform/src/lib/qr.js` (651 lines, no dependencies) encodes byte-mode QR
  versions 1–40 at all four error-correction levels, picks the version from capacity and the mask
  from the ISO penalty rules, and renders SVG, a 1-bit greyscale PNG and a `data:` URI. `POST
  /api/v1/auth/mfa/totp/enroll` now returns `qrPngDataUri` next to `secret` and `otpauthUri` (the
  JSON stays under 1 kB — no SVG copy), and `SecurityPage` renders the image instead of telling the
  user to "scan" a secret it never drew. Evidence, in layers: **744/744 matrices** from an unrelated
  encoder (python-qrcode 8.2, `platform/tests/fixtures/qr-reference.json`, regenerable via
  `tests/fixtures/generate-qr-fixtures.py`) match byte-for-byte, plus 264/264 auto-version selections;
  the penalty score is pinned rule-by-rule against **segno 1.6.6**'s scorer (32 matrices); the bit
  stream is read back out of a finished matrix and its Reed–Solomon check symbols recomputed by a
  second GF(256) implementation; the PNG is decoded by a reader that shares no code with the writer;
  and the image the API actually served was decoded back to the exact `otpauth://` URI by an
  **independent decoder (OpenCV 5.0.0, `cv2.QRCodeDetector`)**. Two limits stated plainly: mask
  *choice* is deliberately not compared across encoders (scanners do not care, and scoring-border
  conventions differ), and a margin-0 / 1-pixel render is legal but not what a scanner reads — the
  API always uses the standard 4-module quiet zone. `segno` 1.6.6's extra `0x00` pad codeword is
  recorded as `segno_padding_deviation` and asserted as a known deviation, not papered over.
- ~~**`platform/scripts/rehash-passwords.js`** — bcrypt → scrypt re-enrolment tool: *not yet implemented*.~~
  **Closed 2026-10-05:** dry-run by default; classifies every account with a password hash as
  `legacy-bcrypt` (cannot be verified or re-hashed — re-hashing needs the plaintext nobody has),
  `stale-scrypt-params` (reported only: the login route upgrades it in place on the next successful
  sign-in) or `blank-hash`, and skips current hashes. `--apply` writes nothing but `auth_recovery`
  rows of kind `password_reset` — `sha256(random 32-byte token)`, one-hour expiry, exactly like
  `POST /api/v1/auth/password/forgot` — and will not stack a second invite on a live one unless
  `--force`. Raw tokens are surfaced only where the platform itself would: stdout in development, or
  a `0600` `--out` file; production refuses `--apply` without one. 9 tests
  (`platform/tests/rehash-passwords.test.js`) run the real CLI as a subprocess against a real store
  and check that the delivered token hashes to the stored row.
- ~~**Payment gateways** — only `sandbox` + `manual` ported; no Stripe / PayPal / Paystack / Blockonomics.~~
  **Closed 2026-10-05 (inbound half, `platform/`):** Stripe, PayPal and Paystack webhooks are now
  implemented in `platform/src/lib/gateways/` + `platform/src/lib/provider-webhook-service.js` —
  per-provider signature verification against the exact raw bytes before any database access,
  canonical event mapping, unique-index event claiming with 60 s lease takeover, zero-trust
  amount/currency/owner/invoice-total invariants, and settlement through the shared
  `applySuccessfulPayment`. 40 tests in `platform/tests/gateways.test.js`; whole suite 357 green.
  Still open, and refused with that reason: **initiating** a real-provider checkout (needs live
  provider egress + PSP credentials).
  **Blockonomics (Bitcoin) — closed 2026-10-08** as far as this build can carry it:
  `platform/src/lib/gateways/blockonomics.js` ports the WHMCS callback contract (timing-safe
  `secret` query parameter, shape gate, confirmation threshold from configuration,
  `addr:txid:confirmations` de-duplication, audit record), reached through a new GET webhook route
  that only a gateway declaring `queryCallback` may use. 7 tests in
  `platform/tests/blockonomics-gateway.test.js`. Initiation stays refused by name (the
  address-issuance API and a recorded BTC quote do not exist here) and so does settlement:
  `NUMERIC(16,2)` money columns cannot hold a Bitcoin amount, so a confirmed delivery is recorded
  and refused with that reason instead of being credited as `0`. USDT/BCH are refused by name. A
  minor-unit ledger column is the follow-up that would make crypto settlement real.
- **SPA dashboard (`platform/spa/`)** — **15 page modules of ~84 ported** (8 customer pages + 7 admin
  modules, the shell included): `DashboardPage` (overview), `CatalogPage` (with add-to-cart and a
  billing-cycle picker), `CartPage` (quantity, remove, checkout), `BillingPage`
  (invoices, subscriptions with cancel-at-period-end and plan-change requests, ledger),
  `InvoiceDetailPage` (balance, ledger, gateway list including refusals with reasons, manual
  instructions, sandbox settlement), `ServicesPage` (services and domains), `SecurityPage`,
  `SupportPage`. The customer purchase path is therefore closed end to end in the
  UI: catalog → cart → order/invoice → payment → settled invoice.
  Two server-side blockers surfaced while wiring it and were fixed additively: cart items now carry
  `planName`/`planSlug`/`productName` (the cart stores a plan id that no public catalog endpoint
  exposes, so a cart UI could only render a UUID), and
  `POST /billing/subscriptions/:id/change-plan` accepts `planSlug` as well as `planId` (the public
  catalog is keyed by slug; slugs resolve inside the subscription's own product).
  The admin console slice is now built: a staff-gated `AdminLayout`, `AdminDashboardPage` (live
  queue counts plus open support sessions), `AdminCustomersPage` (server-side search/role/paging),
  `AdminCustomerDetailPage` (service and domain records for staff; status and role for super admins
  only, with the server's own refusals shown verbatim; "switch to customer" for admins, which parks
  the admin's credentials in `sessionStorage` and adopts a one-hour delegated token that carries no
  refresh token), `AdminTicketsPage` and `AdminTicketDetailPage` (status filter, replies, closing)
  and the admin-only `AdminUsersPage`.
  Still missing: the remaining ~35 admin groups (catalog authoring, servers, DNS, Cloudflare,
  marketplace, AI/tools, security-number policy, …), the customer-facing DNS, Cloudflare and
  marketplace screens, server detail, and the mobile shell.
  **Verification, stated exactly:** the SPA's own API client is imported unmodified and driven
  through the real HTTP pipeline by `platform/tests/spa-commerce.test.js` (26 assertions across the
  journey, scoping and refusal paths), `platform/tests/spa-admin.test.js` (a customer, a staff
  account, an admin and a super admin against the real guards; delegation parked and restored; both
  delegating while delegated and super-admin self-role change refused) plus `spa-format.test.js` for
  the money/date/status helpers. All 15 page modules are also server-rendered once each by
  `npm --prefix spa run smoke` (bad imports and render-time mistakes), and the whole set is compiled
  by the production Vite build. **No browser has rendered these pages in this environment** — there
  is no DOM here — so layout and interaction are not claimed as visually verified.
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

**Whole-platform gates still open:** cPanel staging verification (*BLOCKED — NOT PERFORMED*) and
visual/browser tests (*NOT PERFORMED*).

~~GitHub Actions cannot start on this account (billing blocker), so no commit has a CI signal.~~
**CORRECTED 2026-10-05 — the billing blocker is cleared and CI is green.** Observed on this branch,
not inferred: `Independent foundation` completed `success` on the pushes of both commits here (runs
`37347168282`, `37349198441`, 1m40s and 1m46s), and PR #54's two jobs — `Release candidate (PHP 7.4)`
and `Release candidate (PHP 8.2)` — both `pass` (1m39s, 1m47s). That is also the first time the PHP
release-candidate gate has run on a change in this repository's recorded history, so row A15's caveat
that `php -l` over the 778 computed lint targets "was never executed here" no longer applies to CI,
only to the local sandbox.
