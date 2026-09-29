# CloudHost247 Domain Broker Service

Version 1.1.0 — provider-agnostic domain acquisition brokerage for domains that
are already registered elsewhere. Module: `modules/addons/cloudhost247_broker`.

Changelog: 1.0.0 core engine and dashboards; 1.1.0 adds verified domain
delivery into the customer account (`DomainDeliveryService` + transfer
delivery columns), the outbound provider-call ledger (`GoDaddyAdapter` →
`mod_cloudhost247_broker_provider_calls`), the documented customer "next
action"/agreement/delivery views, and the full Domain Brokerage Terms page on
both shipped themes.

## What this is (and is not)

CloudHost247 Domain Brokerage lets a customer ask CloudHost247 to try to
acquire a domain someone else already owns: search → "Broker This Domain" →
request → assignment → owner contact → negotiation → offer/counteroffer →
customer approval → payment → transfer → verification → completion. A domain
being **registered is never presented as "available for sale."** Nothing in
this module guarantees an acquisition will succeed — every route can end in
"the owner declined" or "manual broker required," and that is shown honestly.

## Safety model

* **No separate credential store.** Every provider adapter (GoDaddy, Sedo,
  Afternic, DomainAgents) resolves its connection exclusively through the
  existing `CloudHost247\Integrations\Services\IntegrationManager` (the
  central API & Integrations vault). The broker module owns zero API keys,
  secrets, or tokens of its own.
* **No separate payment engine.** `PaymentService` creates and reconciles one
  WHMCS invoice per case via `localAPI('CreateInvoice'|'GetInvoice')`. A case
  is only ever marked `payment_pending → transfer_pending` when WHMCS itself
  reports the invoice **Paid** — never on a client-side signal.
* **No separate dispute system.** Disputes reuse the case's own `disputed`
  flag/status and `resolveDispute()`; while disputed, `TransferService` and
  `BrokerageService::transitionStatus()` block every transition except the
  documented dispute-resume set, cancel, or fail. Nothing is auto-refunded or
  auto-released on dispute alone.
* **No core table writes.** Twelve `mod_cloudhost247_broker_*` tables only;
  no WHMCS core table is touched. No foreign keys are declared (indexed
  unsigned integers instead), matching every other CloudHost247 module so the
  install works regardless of the target's FK enforcement settings. Every
  `CREATE TABLE` is guarded by `hasTable()`, so re-running the migration is a
  no-op. Cases are soft-deleted (`deleted_at`), never physically removed.
* **Never fabricates status.** `ConnectionState`, `CaseStatus`,
  `PaymentStatus`, `TransferStatus` and `DomainState` are closed, real-state-
  only enumerations. A provider is reported `Connected` only after
  `IntegrationManager` itself reports a successful, recent health check —
  filling in configuration fields is never enough. GoDaddy's own availability
  check returns `null` (never a guess) the moment its capability isn't active.

## Architecture

```
Customer → Search/Lookup → Broker This Domain → BrokerageService::createCase()
    → AcquisitionRouter::select() → { Route A: marketplace listing found,
       Route B: connected + agreement-confirmed brokerage provider,
       Route C: registrar known, no automated route,
       Route D: Manual CloudHost247 Broker (guaranteed fallback) }
    → owner contact → NegotiationService (offers/counteroffers, immutable)
    → customer approval (never auto-accepted) → PaymentService (WHMCS invoice)
    → TransferService (authorize → initiate → provider confirmed → processing
       → verified → completed)
    → DomainDeliveryService (associate the domain with the customer's
       CloudHost247 account through WHMCS's own API, verified by re-read)
```

One consistent "CloudHost247 Domain Brokerage" experience is shown to the
customer regardless of which route actually served the case; only the stored
`acquisition_route` / `provider_key` on the case record which path was used.

## Provider adapters and real capabilities

| Provider | Key | Declared capabilities | Active without integration+agreement |
|---|---|---|---|
| GoDaddy | `godaddy` | availability, registration, DNS, contacts, transfer | none |
| Sedo | `sedo` | domain search, (gated) for-sale lookup, brokerage request, negotiation | none |
| Afternic | `afternic` | (gated) for-sale lookup, brokerage request | none |
| DomainAgents | `domainagents` | (gated) brokerage request, owner contact, negotiation, offers, counteroffers, transfer, transfer status | none |
| Manual CloudHost247 Broker | `manual` | brokerage request, owner contact, negotiation, offers, counteroffers, transfer, transfer status, delivery | always active (no external API) |

"Gated" capabilities additionally require an administrator to explicitly
confirm the commercial/partner agreement in
**Super Admin → Domain Brokerage → Providers** (`ProviderConfigRepository`).
No aftermarket capability is ever active from configuration alone.

Adding a future provider means writing one `ProviderAdapter` implementation
and registering it with `AdapterRegistry::register()` — the routing engine,
the admin Providers screen, and the customer dashboard never need to change.

## Data model

Twelve tables (`mod_cloudhost247_broker_cases/providers/assignments/offers/
messages/events/payments/transfers/documents/settings/fees/provider_calls`).
Offers and events are insert-only (no status/updated_at column): a negotiation
"decision" is always a new event referencing the offer id, so the history can
never be silently rewritten. `NegotiationService::status()` always *derives*
pending/accepted/rejected/expired/superseded from that history.

Migration `V110` (1.1.0) additively extends the transfers table with the
delivery ledger columns (`delivery_status`, `whmcs_domain_id`, `delivered_at`,
`delivery_note`) behind `hasColumn` guards — nothing is dropped or renamed.

## Domain delivery (verified transfer → customer account)

`TransferService::complete()` is the only path to `CaseStatus::COMPLETED`, and
it only runs after a transfer reached `VERIFIED`. Completion immediately
attempts account delivery through `DomainDeliveryService::associate()`:

1. `localAPI('GetClientsDomains')` — if the domain already has a record owned
   by this customer, it is adopted (idempotent; never duplicated). If the
   record is owned by a **different** account, delivery is recorded `failed`
   and never overridden.
2. Otherwise `localAPI('AddClientDomain')` creates the record through WHMCS's
   own administrative API, and the service **re-reads the client domain list
   to confirm ownership** before reporting `associated`. A create call that
   cannot be confirmed is never claimed as delivered.
3. When WHMCS cannot complete the association in this environment (API
   unavailable or action unsupported), the transfer carries an explicit
   `pending_manual` state plus the exact manual step an operator must take in
   WHMCS Admin → Clients → Domains. A Super Admin can then retry from the case
   screen ("Deliver / re-check domain delivery") — the retry is idempotent.

Only `associated` produces the customer-facing `delivery.associated` event and
the "Domain delivered" email; the transfer-completed notification deliberately
does not claim account association before it has been confirmed.

## Security controls

* `Security\AdminGuard::requireAdmin()` / `requirePostToken()` gate every
  admin action; `Security\ClientGuard::requireClient()` / `requirePostToken()`
  (backed by WHMCS `check_token('WHMCS.default')`) gate every client action.
* `Security\CaseGuard::assertOwnedByClient()` and
  `CaseRepository::belongsToClient()` enforce per-customer ownership at the
  repository layer, not only in the controller.
* `AdminGuard::capability('cloudhost247_broker', ...)` scopes brokers to only
  their assigned cases unless they hold `cases.view_all`.
* Every state-changing action is written through `AuditLogger::record()` with
  actor, action, case id, before/after metadata (never secrets), and result.
* `BrokerageService::assertWithinRateLimit()` enforces a real, DB-backed
  per-customer request rate limit (`SettingsRepository::
  request_rate_limit_per_hour`, default 5/hour) before a case is created —
  counted from the customer's own real case rows, never a client-side check.
* `Security\InputValidator` centralizes domain/money/currency/idempotency-key/
  future-date validation for every value that reaches the engine.

## Idempotency

`idempotency_key` columns exist on cases, offers, payments and transfers.
`BrokerageService::createCase()`, `NegotiationService::submit()`,
`PaymentService::createInvoice()` and `TransferService::authorize()` all
short-circuit to the original row on a retried key — never a duplicate case,
offer, invoice, or transfer. `TransferService::complete()` itself is
idempotent: re-completing a case returns the existing record without
duplicating events, audit rows, or the delivery attempt.

`ProviderCallRepository` additionally gives an idempotency ledger at the
provider boundary (unique on provider + operation + idempotency key).
`GoDaddyAdapter` records every real availability call there with the
correlation id, the sanitized `ResultCode`, the HTTP status and the latency —
raw provider payloads, credentials and headers are never written.

## Settings

**Super Admin → Domain Brokerage → Settings** exposes: brokerage
enabled/disabled, manual broker fallback, supported currencies, contact
attempt limit, negotiation expiration hours, customer notification toggle,
transfer verification requirement, refund window (days), brokerage terms URL,
and the request rate limit. Defaults are deliberately conservative
(brokerage disabled, manual fallback on) so a freshly installed, unconfigured
deployment never silently exposes the feature.

## Installation

1. Activate **CloudHost247 Foundation** and **CloudHost247 API &
   Integrations** first.
2. Deploy `modules/addons/cloudhost247_broker`.
3. Activate **CloudHost247 Domain Brokerage** — migration `V100` creates the
   twelve namespaced tables only; re-activation is a no-op.
4. Connect GoDaddy/Sedo/Afternic/DomainAgents from **Super Admin → API &
   Integrations** (optional). Confirm any partner/commercial agreement from
   **Super Admin → Domain Brokerage → Providers** before its gated
   capabilities activate. The Manual CloudHost247 Broker route works
   immediately with zero external configuration.
5. Deactivation retains all case, offer, payment, transfer, and audit data.

## Testing

`tests/broker/run.php` is a self-contained behavior suite (fake in-memory
Capsule query builder + a stubbed Integrations manager/localAPI mirroring the
pattern already used by `tests/foundation/run.php` and `tests/tools/run.php`)
that exercises the real domain enums, provider adapters, routing,
repositories, fee math, and the full brokerage → negotiation → payment →
transfer → delivery → completion lifecycle against the actual module classes,
including: delivery association/adoption/conflict/manual-fallback honesty,
completion idempotency, the provider-call ledger (success, auth failure and
transport failure), and the customer notification toggle.
`tests/broker/test_static.py` asserts structure, security, and "no fabricated
data" invariants. Neither test requires network access or a real WHMCS/MySQL
runtime. CI runs both suites plus `scripts/release-candidate-check.sh` on
PHP 7.4 and PHP 8.2 (`.github/workflows/independent-foundation.yml`).

## Module Manager compatibility (requirement #43)

This service is a first-party repository module, shipped in this repository
and activated through WHMCS's own **System Settings → Addon Modules** flow —
the same trust path as `cloudhost247_core`, `cloudhost247_integrations`,
`cloudhost247_builder`, `cloudhost247_currency`, `cloudhost247_ovh`,
`cloudhost247_theme` and the `RDP` server module. It is therefore **not** an
untrusted upload and it does not enter the Package Installer pipeline
(`cloudhost247_modules`), which exists precisely for *third-party* ZIP
uploads: validated `module.json` manifest, dependency/compatibility checks,
migrations through the Foundation `MigrationRunner`, capability-declared
permissions, byte-verified installs and safe rollback, with no blind
execution of packaged code. The broker module plays by the same rules its
peers do: namespaced additive migrations, activation non-destructive,
deactivation retains data, and zero credentials stored outside the central
vault. Should this module ever be repackaged as an uploadable distribution,
its `module.json` must declare the `cloudhost247_core` and
`cloudhost247_integrations` runtime dependencies it has.

## Feature status

| Capability | Status | Evidence / limitation |
|---|---|---|
| Full request → completion lifecycle | IMPLEMENTED (source) | `BrokerageService`, `NegotiationService`, `PaymentService`, `TransferService` |
| Provider-agnostic adapter architecture | IMPLEMENTED (source) | `AdapterRegistry`, `ProviderAdapter`, 4 real adapters + manual fallback |
| Central API & Integrations reuse | IMPLEMENTED (source) | `AbstractIntegrationAdapter` → `IntegrationManager`; no separate credential store |
| Existing payment system reuse | IMPLEMENTED (source), runtime BLOCKED | `localAPI('CreateInvoice'/'GetInvoice')`; needs a staging WHMCS billing runtime |
| Existing dispute functionality reuse | IMPLEMENTED (source) | Case `disputed` flag + `markDisputed`/`resolveDispute`, blocks irreversible actions |
| Admin dashboard (overview/queues/providers/fees/settings/reports/audit) | IMPLEMENTED (source) | `Http/AdminController` + `AdminView` |
| Customer dashboard (case list/detail/timeline) | IMPLEMENTED (source) | `Http/ClientAreaController` + `list.tpl`/`new.tpl`/`detail.tpl` |
| RBAC / ownership isolation | IMPLEMENTED (source) | `CaseGuard`, `ClientGuard`, `AdminGuard::capability` |
| Idempotency (cases/offers/payments/transfers) | IMPLEMENTED (source) | `idempotency_key` columns + short-circuit lookups |
| Audit logging | IMPLEMENTED (source) | `AuditLogger::record()` on every state-changing action |
| Server-side rate limiting | IMPLEMENTED (source) | `BrokerageService::assertWithinRateLimit()`, real DB count |
| Page Builder widgets (Broker CTA, status, cases, pricing, FAQ) | IMPLEMENTED (source) | `cloudhost247_builder` `WidgetCatalog` (`broker_this_domain`, `domain_brokerage_cta`, `brokerage_status`, `customer_brokerage_cases`, `brokerage_pricing`, `brokerage_faq`) via `LiveDataSource` → real broker repositories (asserted by `tests/broker/test_static.py` + `tests/builder/`) |
| Domain delivery to customer account | IMPLEMENTED (source), runtime BLOCKED | `DomainDeliveryService` through `localAPI('GetClientsDomains'/'AddClientDomain')` with confirm-by-re-read; needs a staging WHMCS runtime for live verification |
| Outbound provider-call ledger | IMPLEMENTED (source) | `GoDaddyAdapter` → `ProviderCallRepository::record()` (correlation id, sanitized result code, HTTP status, latency) |
| Runtime/staging verification with live provider credentials | BLOCKED | No real GoDaddy/Sedo/Afternic/DomainAgents partner credentials or WHMCS/MySQL runtime is available in this environment; provider access must be legitimately obtained and tested before enabling (see \"Provider adapters and real capabilities\") |
