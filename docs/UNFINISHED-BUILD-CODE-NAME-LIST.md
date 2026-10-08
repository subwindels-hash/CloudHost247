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
| 2026-10-08 | §1.1 row 4 — `platform/src/domains/admin-domain-services.js` (registrar connector: transfer refresh poll, extension catalogue sync, `namecheap` + `godaddy` adapters) | `platform/src/lib/domain-providers/adapters/namecheap.js` (401 lines, full XML API: availability with premium pricing in 50-name batches, TLD catalogue, registration, transfer, live domain status) + `.../godaddy.js` (sso-key REST: availability with the documented two price-unit shapes, purchase with consent, transfer, live status, both unit bugs asserted) + `.../xml.js` (hardened reader, DOCTYPE/entity refused outright) + `lib/domain-transfer-service.js` (poll + completion as one transaction, completion **labelled by evidence**) + `lib/domain-extension-sync.js` (provider quotes recorded against the provider; the platform's selling prices untouched) + `lib/domain-availability.js` (the customer search now prefers a connected registrar's authoritative answer and falls back to RDAP, labelling which spoke). `platform/tests/fixtures/fake-registrar.js` (Namecheap XML **and** GoDaddy JSON) + `platform/tests/domain-registrar-adapters.test.js` (28 tests over real HTTP). The deferred markers are gone: `/transfers/:id/refresh` no longer returns `status: 'deferred'`, `/extensions/sync` no longer returns a hardcoded `{synced: 0}`. Inline `encryptCreds` reconciled onto `lib/secret-box.js` (one envelope implementation, legacy ciphertext still opens). Full suite: **823 pass / 0 fail**. No registrar account exists in this environment — both wire contracts are verified against the loopback fake only. |
| 2026-10-08 | §2 row 6 — Blockonomics (Bitcoin) gateway ported to `platform/` | `platform/src/lib/gateways/blockonomics.js` (the callback contract of `modules/gateways/callback/blockonomics.php`: the query-string `secret` compared in constant time over digests, the field shape gate, the confirmation threshold taken from configuration and never from the caller, the `addr:txid:confirmations` de-duplication key, and an audit record that keeps the delivery as received) + a **GET** webhook route in `platform/src/domains/webhooks.js`, permitted only for a gateway that declares `queryCallback` + `platform/src/lib/money.js` (currency precision, and the ledger's own two-decimal limit in one place) + the receiver's named refusal for an amount the money columns cannot hold. 7 tests in `platform/tests/blockonomics-gateway.test.js`; full suite **846 pass / 0 fail**. Initiation and settlement stay refused with named reasons — the address-issuance API plus a recorded BTC quote do not exist here, and `NUMERIC(16,2)` money columns cannot store a Bitcoin amount. No live Blockonomics account was reachable from this environment; the callback contract is exercised through the real HTTP route, never against the provider. |
| 2026-10-08 | §1.1 row 3 — `platform/src/domains/domain-services.js` (availability / WHOIS-RDAP / appraisal connector) | `platform/src/lib/domain-providers/` (`types`, `http`, `registry`, `register-builtins`, `adapters/rdap`, `adapters/govalue`) + `lib/domain-provider-service.js` + `lib/domain-name.js`; `platform/tests/domain-providers.test.js` (26) + `platform/tests/domain-services-egress.test.js` (27) over the real app against `platform/tests/fixtures/fake-registry.js`. Full suite: **795 pass / 0 fail**. The regex availability guess is gone: with no connected provider the routes return `available: null`, not a verdict. No real registrar/RDAP account was reachable here — the RDAP and GoValue wire contracts are verified against the loopback fake only. |

---

## 1. In-build — code exists, features explicitly missing

### 1.1 `platform/` — live provider egress (all six rows closed)

The domain modules in `platform/` that still carry a `deferred` marker for live integration
(`ls platform/src/domains` = 45 modules). **All six rows are now closed** — the Cloudflare modules
reach Cloudflare inside the request, the domain connector reaches a registry or a registrar, the
Copilot answers from the platform's own tables, the support assistant answers from a reviewed
catalogue and escalates everything else into a real ticket, and each one refuses with a named reason
when it cannot:

| # | Module | Deferred capability | State |
|---|---|---|---|
| 1 | `platform/src/domains/cloudflare.js` | Live Cloudflare HTTP client, live record write, live purge (writes go to the synchronized cache; purge queues a durable job) | **closed 2026-10-08** |
| 2 | `platform/src/domains/admin-cloudflare.js` | Live Cloudflare egress — "Test Connection" never fakes success | **closed 2026-10-08** |
| 3 | `platform/src/domains/domain-services.js` | Availability / WHOIS-RDAP lookup / appraisal provider connector (returns `provider_unavailable`) | **closed 2026-10-08** |
| 4 | `platform/src/domains/admin-domain-services.js` | Registrar transfer refresh poll; extension catalogue sync; registrar adapters (`namecheap`, `godaddy`). **All closed** — Test Connection is a real provider call, the installed-adapter list is the compiled registry's own answer, the refresh polls the registrar that holds the transfer, and the sync pulls the registrar's real TLD catalogue. | **closed 2026-10-08** |
| 5 | `platform/src/domains/ai-os.js` | Model adapter — Copilot inference (prompt is recorded, no reply is produced). **Closed** — `POST /admin/ai/copilot` and `POST /account/ai/assistant` now answer from the platform's own tables through `platform/src/lib/ai-copilot.js` (deterministic intent router, 14 admin + 9 customer commands) and `platform/src/lib/ai-copilot-data.js` (19 real queries). There is no model in the path and no model was needed: a match renders `evidence` naming the query and row count behind every answer, an empty table reads "None found (real query, zero rows)", a failed query reports the real error and adds "Nothing was fabricated", and an unrouted prompt returns `confidence:'none'` with the supported-command list ("I will not guess"). The customer scope is forced to `auth.id`, so one account cannot read another's invoices, and the only write the assistant can perform is a ticket on the customer's own explicit `open ticket: …` request. 6 tests in `platform/tests/ai-copilot.test.js`. Inference *by an external model* remains out of scope here — that was never the deferred capability, and it is not faked. | **closed 2026-10-08** |
| 6 | `platform/src/domains/ai-support.js` | LLM inference (human agents reply manually). **Closed** — the assistant is now `platform/src/lib/support-operator.js`, ported from `cloudhost247-node/src/ai/knowledge.ts` + `services/ai-support-operator.ts`: a reviewed, code-owned catalogue of 17 CloudHost247 answers with deterministic keyword retrieval, published prices read from the real `catalog_*` rows, and a newsletter **form request** rather than a claim. Everything it cannot verify is escalated: refunds, security reports, complaints, explicit human requests, account-specific questions and server-down reports are checked *before* retrieval, so no keyword overlap can route them into a documentation answer. The escalation is real — an available agent is assigned and notified, the reason sets the priority and the department, a signed-in customer gets a `support_tickets` row carrying their own first message, and the reply says a representative has it **only when one does**. Assistant messages store `intent`/`confidence`/`knowledge_sources` so an agent inheriting the conversation can see why it answered. External *model* inference is still not enabled on this deployment — it was never the observable capability, and nothing fakes it; the engine label on every answer is `deterministic-retrieval`. 6 tests in `platform/tests/support-operator.test.js`. | **closed 2026-10-08** |

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

Both rows are about the audited TS build's own route surface. The `platform/` port is the tree that
runs, so each row was settled by checking what that port actually serves.

| # | Module | Deferred | State |
|---|---|---|---|
| 1 | `src/routes/billing.ts` | Admin/staff invoice-viewing routes — deferred to Phase 5F | **closed by the port** — `platform/src/domains/admin-billing.js` serves `GET /api/v1/admin/invoices` (status filter, pagination, 500-row cap) and `GET /api/v1/admin/invoices/:id` (line items, ledger entries, payment attempts, customer, linked order), plus ledger, reconciliation, refund and cancel. The guard is `asAdmin` by choice, not by omission: refunds and cancellations move money, and staff reach the same invoice numbers/statuses through the order routes below. |
| 2 | `src/routes/commerce.ts` | Admin/staff order-viewing and management routes — deferred to Phase 5F | **closed 2026-10-08** — `platform/src/domains/commerce.js` now serves `GET /api/v1/admin/orders` (filters: status, userId, reference, date window; pagination with a filtered `total`; customer email, item count, invoice number/status, payment status), `GET /api/v1/admin/orders/:id` (line items with resolved product/plan names, customer, every invoice with its ledger + payment attempts, and the fulfilment the order produced — installations, their deployments, services, provisioning jobs), and `POST /api/v1/admin/orders/:id/cancel` (admin-only, mandatory reason). Reading is `asStaff`; cancelling is `asAdmin`. The detail view reports its own cancellation guards up front, and a settled order is **refused with the refund route named** rather than quietly marked cancelled. 4 tests in `platform/tests/admin-orders.test.js`; found and fixed while wiring it: `customer_services.order_id` did not exist, so `lib/order-provisioning.js`'s service join could never match — the column is now in the schema. |

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
| 6 | Blockonomics (Bitcoin/USDT) gateway | `modules/gateways/blockonomics/` — used by the WHMCS build. **Platform port landed 2026-10-08**; the WHMCS plugin itself is still not deployed. `platform/src/lib/gateways/blockonomics.js` ports the callback contract — the `secret` query parameter compared in constant time (over digests, so length does not leak either), the shape gate on `status`/`value`/`addr`/`txid` before any of them is used, the confirmation threshold from `BLOCKONOMICS_CONFIRMATIONS` (never from the callback), an `addr:txid:confirmations` de-duplication key so a re-delivery of one confirmation level is dropped while the transition upward is a new event, and a `webhook_events` record carrying the delivery as received. It is wired into the strict receiver, whose POST-only assumption is gone: a gateway that declares `queryCallback` may be called by GET, every other provider still needs its signed bytes, and an unverified caller writes no rows at all. Two parts remain unperformed in this build, and both are **refused with a named reason rather than simulated**: (a) *checkout initiation* — issuing the monitoring address needs the Blockonomics address API (key + egress) and a recorded `BTC amount + rate + quoted-at` quote, so `listGateways` and the initiation route refuse and say so; (b) *settlement* — money columns are `NUMERIC(16,2)`, so a confirmed BTC delivery would be stored as `0` while the payment was marked `succeeded`; the receiver records the delivery and refuses it by name (`exceedsLedgerPrecision`, naming the figure it would have stored), and keeps settlement on the staff-confirmed manual gateway. USDT and BCH are refused by name as well (different units, different quotes). **Follow-up this exposed:** a minor-unit ledger column is what would make crypto settlement real — a schema change of its own, not a gateway change. 7 tests in `platform/tests/blockonomics-gateway.test.js`. |

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
- `platform/domain-services/registrar`: the Namecheap XML API and the GoDaddy REST API are implemented
  against their published documentation and verified end-to-end against `platform/tests/fixtures/
  fake-registrar.js` over real HTTP — but **no registrar account has ever been called from this
  environment, and none exists to call**. What the fake cannot settle: whether Namecheap's real
  `getInfo` returns a `TransferStatus` element at all (the adapter reads one when present and stays
  silent when absent, so a transfer completes there only via the labelled registration-status
  fallback), whether real GoDaddy availability answers carry `prices[]` or the legacy `price` field,
  the real shopper/consent requirements on a live account, and whether a live key passes the IP
  allowlist. One further gap that is scheduling, not code: transfers are polled when an operator
  refreshes one (Admin → Domain Services → Refresh) or when anything calls
  `lib/domain-transfer-service.js#refreshTransfer`. **No scheduler calls it on a timer yet** — the
  audited Node build had `worker/domain-services-sweep.ts` for that, and a platform equivalent still
  has to be wired to whatever runs `crons/`. Until it is, a transfer advances only on operator action.
  Run one real availability check, one real catalogue sync and one real transfer refresh through a
  staging deployment before trusting them in production.
- `platform/domain-services` pricing: a registrar's quote is recorded in
  `domain_provider_extension_offerings` and surfaced on a search row as `providerQuote`; it is **not**
  the platform's selling price. Nothing has ever set a selling price automatically — a synced
  extension starts at `register_price_cents: 0`, which the quote route refuses to price rather than
  sell for nothing. That is deliberate, and it means a fresh catalogue needs an operator to price it.
- `platform/domain-services`: the RDAP connector has **never queried the real IANA bootstrap file or a
  real registry** from this environment. `platform/tests/fixtures/fake-registry.js` reproduces the
  bootstrap format, the RFC 9082/9083 domain projection, RFC-conformant 404s and the port-43 referral
  chain, but the fakes cannot settle: whether `data.iana.org` is reachable from the production host at
  all, whether real registries agree with the fake about field casing and redaction wording, the real
  port-43 behaviour of registries that block WHOIS by source address, and GoValue's real response
  shape under its own rate limits. Run one real search and one real WHOIS through a staging deployment
  before trusting the projections in production.

---

## Quick copy/paste name list

**Platform — deferred egress:** *(none left in §1.1)*
*(All six rows — `cloudflare`, `admin-cloudflare`, the `domain-services` connector, the
`admin-domain-services` registrar work (transfer refresh, extension sync, `namecheap`/`godaddy`
adapters), the `ai-os` Copilot and the `ai-support` operator — were closed 2026-10-08; see §1.1.)*

**Platform — partial:** `platform/spa` (17 page modules ported, ~35 admin groups + DNS/Cloudflare/
marketplace/server-detail/mobile shell missing) · `platform/mobile` (no app code)

**Node adapters — refused capabilities:** `aws` (rescue; reinstall gated) · `digitalocean`
(console, rescue) · `contabo` (resize, console, metrics) · `proxmox` (rescue) · `virtualizor` (rescue) ·
`solusvm` (snapshot, arm64 rescue) · `mock` (console, metrics) · `UnavailableNativeProviderAdapter` ·
`cpanel-adapter` (restartApplication, applicationLogs) · `kubernetes-adapter` (backup/restore, hosting
provisioning) · `docker-adapter` (hosting ops)

**Node routes deferred:** ~~`billing.ts` (admin invoice views → 5F)~~ · ~~`commerce.ts` (admin order views → 5F)~~
*(both settled against the port — the invoice console already existed as `admin-billing.js`, and the
order surface landed 2026-10-08 in `commerce.js`; see §1.5)*

**Frozen:** webhook pipeline (`routes/webhooks.ts`, `services/webhook-service.ts`,
`payments/{stripe,paypal,paystack,sandbox}-gateway.ts`) · migrations `0023` · `0024` · `0025` · `0041` ·
~~Blockonomics gateway~~ *(settled against the port on the platform side — the callback contract is
implemented and tested, and the two capabilities this build cannot perform are refused by name; see
§2 row 6)*

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
