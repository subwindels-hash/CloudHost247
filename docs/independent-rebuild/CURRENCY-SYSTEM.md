# CloudHost247 Currency System

Version 1.1.0 — independent replacement for required currency functionality.

## Safety model

The update engine writes only `tblcurrencies.rate` for explicitly enabled WHMCS currencies and its own `mod_cloudhost247_currency_*` tables. It never writes `tblpricing`, invoices, invoice items, transactions, clients, services, or product records. Rate history is immutable per run. Current exchange rates, currency policy, update history, product prices, and historical financial documents remain separate.

Each update obtains a database lease, fetches and validates a complete rate set, calculates effective values, and writes all enabled current rates and history in one database transaction. Missing/invalid rates roll back the entire write. The base rate is always 1. Failed attempts are recorded and secrets are redacted by the shared logger.

## Providers

* **Frankfurter** (`api.frankfurter.app`) — JSON daily reference rates, supports selectable bases.
* **European Central Bank** — official XML daily euro reference rates; cross-rates are normalized for a configured non-EUR base.

Providers are tried in priority order and each receives one retry. TLS peer/host verification, response-size limits, connect/read timeouts, strict status checks and complete symbol validation are enforced. No API keys are currently required. Provider terms, availability and supported currencies must be reviewed by the operator.

## Configuration

The administrator can set the base currency, update interval (15–43,200 minutes), enabled providers, enabled WHMCS currencies, per-currency margin (-99% to 1000%), precision (0–12), and rounding (`nearest`, `up`, `down`). Base currency must already exist in WHMCS. The dashboard provides current rates, current/previous comparison, provider status, manual update, run history, timestamps and errors.

An effective rate is `provider rate × (1 + margin / 100)`, then rounded with the selected policy. Conversion uses `amount ÷ source rate × target rate`; conversion helpers do not mutate billing data.

## Installation and upgrade

1. Back up and clone WHMCS to staging. Activate **CloudHost247 Foundation** first.
2. Deploy `modules/addons/cloudhost247_currency` and `crons/cloudhost247_currency.php`.
3. Activate or upgrade **CloudHost247 Currency**. Migrations 1.0.0 and 1.1.0 are idempotent and only create `mod_cloudhost247_*` tables/defaults.
4. Confirm WHMCS currencies, configure policies, leave non-required currencies disabled, and run **Update Now** on staging.
5. Compare values and run history before enabling scheduling. Deactivation retains data and does not revert current rates automatically.

No Xtreme Currency Rates licence key, files, activation, or service is required.

## Scheduling

The preferred scheduler is the `AfterCronJob` WHMCS hook; it checks the configured interval. An optional CLI entry is available:

```cron
17 * * * * /usr/bin/php /path/to/whmcs/crons/cloudhost247_currency.php >> /path/outside/webroot/currency-cron.log 2>&1
```

Use either the normal WHMCS schedule or the optional CLI at the desired cadence. The shared lock makes overlap safe, but redundant schedules cause unnecessary provider calls. The CLI rejects web requests and returns nonzero on failure.

## Feature status

| Capability | Status | Evidence / limitation |
|---|---|---|
| Provider configuration | IMPLEMENTED (source), runtime BLOCKED | Admin enable/disable and priority-backed repository |
| Multiple providers/fallback/retry | IMPLEMENTED (source), runtime BLOCKED | Frankfurter + ECB; two attempts each |
| Automatic/manual/CLI updates | IMPLEMENTED (source), runtime BLOCKED | WHMCS hook, button, CLI |
| Conversion/margins/rounding/base | IMPLEMENTED and unit-tested | Pure `RateMath`; DB path needs staging |
| Enabled currencies/frequency | IMPLEMENTED (source), runtime BLOCKED | Validated policy tables/UI |
| History/current/previous comparison | IMPLEMENTED (source), runtime BLOCKED | Immutable rate rows and run dashboard |
| Success/failure/error logging | IMPLEMENTED (source), runtime BLOCKED | Run records plus redacted shared logs |
| Concurrent execution protection | IMPLEMENTED (source), runtime BLOCKED | Expiring owner lease and transaction |
| WHMCS current-rate integration | IMPLEMENTED (source), runtime BLOCKED | Only `tblcurrencies.rate`; requires staging schema test |
| Product price rewriting | NOT APPLICABLE | Deliberately not performed |
| Historical invoice rewriting | NOT APPLICABLE | Explicitly prohibited and static-tested |
| Provider dashboard widget on WHMCS home | PARTIAL | Addon dashboard exists; native admin-home widget not added |
| Runtime/cron/network verification | BLOCKED | Secure WHMCS staging is not provisioned |

## Security and limitations

All admin mutations require authenticated WHMCS admin context and CSRF validation. Values and provider identifiers are allowlisted/validated. This module does not replace WHMCS authentication, licensing, currencies UI, invoice accounting, or permissions to access the addon. Currency APIs can be unavailable or change behavior; a failed provider set never partially updates rates. PHP decimal floats are used because WHMCS currency rates are stored numerically; validated precision is capped at 12. Production readiness is not claimed before WHMCS 8.x/PHP 8.2 staging verification.

## Pre-staging status clarification

**IMPLEMENTED / automated:** provider parsing, conversion, margins, rounding, validation, lock/transaction structure, history and current-rate-only write boundary. **BLOCKED — STAGING REQUIRED:** real providers, WHMCS hooks/database, cron concurrency, admin permissions and financial before/after hashes. OVH pricing previews consume current CloudHost247/WHMCS currency rates while preserving source price, source currency, conversion, margin, rounding and final value separately. Applying OVH product pricing is a distinct explicitly confirmed operation and is never performed by currency updates.

## Source management layer update (2026-09-27)

**Project state: SOURCE DEVELOPMENT → STAGING PENDING.** CloudHost247 now includes additive source foundations for confirmed hosting-product metadata, pricing comparison evidence, redacted searchable audit events, currency policy administration, OVH operational filtering/reconciliation evidence, safe customer service states, and audited CMS mutations. WHMCS remains authoritative for products, pricing, billing, ownership, and authentication.

- **IMPLEMENTED (source):** CSRF/role checks, explicit confirmation for consequential writes, namespaced metadata, current-versus-proposed pricing evidence, one-use price previews with stale-price rejection, audit filtering/pagination, bounded operational queries, reconciliation guidance that does not automatically repeat uncertain mutations, localization/preview fallback, output escaping, and secret redaction.
- **PARTIAL:** Product specifications require runtime UI validation; operational next-sync/rate-limit visibility depends on persisted provider evidence; customer lifecycle buttons remain limited to operations already authorized by the server module; visual presentation needs browser evidence.
- **BLOCKED — STAGING REQUIRED:** real migrations/database transactions, WHMCS hooks and client area, browser/accessibility rendering, cron, currency HTTP providers, OVH authentication/API calls, provisioning and lifecycle operations.
- **NOT IMPLEMENTED — API/PRODUCT DEPENDENCY:** provider capabilities not exposed by an authenticated OVH product/API are not guessed; unsafe mutation retry is intentionally unavailable.

Migration ordering is core `1.1.0`, currency `1.0.0 → 1.1.0`, theme `1.0.0 → 1.1.0`, and OVH `1.0.0 → 1.1.0 → 1.2.0 → 1.3.0 → 1.4.0 → 1.5.0`. All migrations are additive/idempotent and retain data on module deactivation. No WHMCS core schema is altered. Before upgrade, back up the database; rollback means restoring that backup and the prior source commit because additive tables/columns are deliberately retained.
