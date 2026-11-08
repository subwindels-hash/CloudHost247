# Google Workspace reseller module: audit and implementation plan

Date: 2026-11-08. Status: **not implemented as a reseller service; not production-ready**.
This is an assessment of repository code, not verification of a deployed WHMCS installation,
Google account, payment gateway, or live API. No purchases or provider operations were made.

## Existing implementation

* `modules/servers/cloudhost247_email_hosting/` is the newer WHMCS server module.
  `GoogleWorkspaceProvider.php` uses delegated service-account authentication, Directory API
  user management and Enterprise License Manager to manage individual users in an **existing**
  Google tenant. It does not create reseller customers or subscriptions. The module has WHMCS
  lifecycle entry points, per-service locks, operation records and reconciliation for its
  mailbox workflow; those mechanisms are not proof of subscription-level idempotency.
* `modules/servers/cloudhost247_email/` is a separate older WHMCS server module with Google
  code. Both exist in the repository. Do not install another module or automatically migrate
  or remove either: first inventory actual product/server assignments and data on staging.
* `email-hosting.php`, `PublicCatalog.php`, the WHMCS theme template and `ContentRepository.php`
  expose a general email catalogue backed by WHMCS products and pricing. The newer module's
  mailboxes-included setting is informational, not per-seat subscription billing. Its client
  template offers mailbox status and DNS information, not full Workspace administration.
* `hooks.php` and `cron.php` run mailbox reconciliation. `Renew` syncs a mailbox; it does not
  synchronize a Google reseller subscription renewal. The module supports configured DNS
  instructions and does not write DNS. Its Google webhook is refused, not a verified provider
  event integration.
* Existing surrounding infrastructure includes WHMCS product/cart/invoice functions and the
  currency addon in `modules/addons/cloudhost247_currency/`; domain and integrations addons;
  WHMCS email templates and module hooks. The independent `cloudhost247-node/` application
  has commerce, domain, currency, payment, authentication and notification components, but
  their existence does not establish an integrated WHMCS Workspace checkout. The separate
  `platform/` backend also exists; see `docs/ARCHITECTURE-DECISION-RECORD.md` before choosing
  any Node integration. Do not create a parallel billing ledger for Workspace.
* `tests/cloudhost247_email/run.php` is a mock-only PHP harness for the newer email module.
  It does not verify WHMCS billing or Google reseller subscriptions.

## Gaps and risks

No Google Reseller API customer/subscription integration, verified reseller catalogue, seat
ordering or subscription-level service state was found. There is no demonstrated complete
order-to-payment-to-provisioning-to-renewal flow, provider subscription reconciliation,
Workspace-specific customer/admin management, comprehensive notification workflow, or live
integration verification. Catalogue features, prices, provider terms, supported countries and
seat limits must come from authorized configuration, not inferred from example SKUs.

The Google adapter now rejects a matching Directory user on conflict instead of adopting it.
A matching address alone is not sufficient evidence that an existing user or tenant belongs
to a particular WHMCS service or that the requested license is assigned. A reseller workflow must establish authorization and
ownership before any adoption and reconcile licenses before reporting success. The existing
mailbox lifecycle must not be represented as subscription provisioning. Google subscription
suspension/cancellation and Directory user suspension/deletion are different operations; map
and authorize them separately. WHMCS billing renewal alone is not provider renewal.

## Proposed implementation sequence and file map

These are **planned**, not completed; exact names may change after a staging inventory and
Google API contract review. Avoid duplicating existing tables, modules, routes or billing logic.

1. Inventory deployed WHMCS product/server assignments and schemas; decide an explicit legacy
   migration plan. Review `modules/servers/cloudhost247_email/` and
   `modules/servers/cloudhost247_email_hosting/` before touching either.
2. Extend the newer module in place: add a distinct reseller adapter under
   `modules/servers/cloudhost247_email_hosting/lib/Providers/`, and subscription workflow,
   repository and reconciliation classes under its existing `lib/Service/` and
   `lib/Repository/` directories. Update `cloudhost247_email_hosting.php`, `functions.php`,
   `hooks.php`, `cron.php`, `lib/Support/Config.php` and `README.md` only where needed.
   Keep existing mailbox behavior and other providers compatible. Explicitly model uncertain
   mutations and reconciliation; never blindly retry a non-idempotent create.
3. Design additive, versioned migrations under `install/migrations/` after inspecting the
   existing `install/schema.sql`, `lib/Database/Migrator.php`, WHMCS service records and
   deployed data. Unique service/provider identifiers and operation claims must be enforced
   by the database. No migrations have been created or run in this audit.
4. Extend `lib/Service/PublicCatalog.php`, the existing WHMCS client area templates and
   admin surfaces only after real backend operations and permissions exist. Link orders to
   actual WHMCS products, configurable options, invoices and services; let WHMCS own tax,
   payment, credits and recurring billing. Store verified, country/currency-specific catalogue
   configuration without hard-coded prices or entitlements. Fail closed when unavailable.
5. Add mocked tests to `tests/cloudhost247_email/run.php` or its successor for API contracts,
   uncertain outcomes, authorization and replay, plus WHMCS integration tests and mobile
   end-to-end tests in an isolated staging environment. Validate the entire payment, invoice,
   subscription and provider reconciliation chain with authorized non-chargeable test data.

## Changes made in this audit

Public copy in `shared/site/content/hosting.json`,
`modules/addons/cloudhost247_theme/resources/site.json`, and
`cloudhost247-node/frontend/src/content/pages.generated.json` no longer claims that the platform
can provision Google Workspace subscriptions. This report is new. No routes, tables, API integrations or migrations have been added, and no existing module has
been removed or migrated.

A subsequent safety upgrade modifies `lib/Providers/GoogleWorkspaceProvider.php`,
`lib/Service/Provisioner.php`, `lib/Service/Reconciler.php`, the module README and
`tests/cloudhost247_email/run.php` under `modules/servers/cloudhost247_email_hosting/` (the tests
file is at the repository root). Google user conflicts now fail closed; uncertain partial creates
retain the remote user id; a stored id no longer turns a failed create into success; and Google
user lookup or Directory status alone no longer automatically clears those partial creates.
These changes require manual review, not automatic recovery. The Google adapter also verifies a licence assignment after a conflict and refuses to delete a user if licence release fails. They do not add reseller features.

## Verification and activation blockers

The mock PHP harness passed 66/66 checks using PHP WebAssembly with a temporary OpenSSL
configuration; this does not exercise WHMCS database-backed lifecycle or a live provider. The
new conflict and timeout tests exercise the provider adapter, not the database reconciliation
path, which still needs WHMCS staging tests. There is no configured authorized Google reseller test account, WHMCS
installation/database, verified catalogue, or test payment setup available for integration
verification. Actual Google API authentication, provisioning, subscription management,
WHMCS invoices, callbacks, renewal, and notification delivery are **not verified**. No API
credentials or secrets were requested or stored. Automated tests for the requested full module
have not been implemented. Production activation requires a reseller agreement and authorized
API access, secure credentials and scopes, provider-approved offerings and terms, WHMCS product
and payment configuration, a staging environment and explicit authorization for any potentially
chargeable provider activity. Until these are met, do not market or activate this as a complete
reseller service.


## Reseller read-only connectivity phase (2026-11-08)

* Added `modules/servers/cloudhost247_email_hosting/lib/Providers/GoogleResellerConnection.php`.
  It signs a delegated service-account assertion for the reseller administrator, exchanges it
  at `https://oauth2.googleapis.com/token`, and calls the official read-only
  `GET https://reseller.googleapis.com/apps/reseller/v1/subscriptions?maxResults=1` endpoint.
  It keeps the token in memory, respects expiry and refreshes once after a read-only 401;
  it neither logs provider response bodies nor returns token or subscription data.
* Modified `lib/Providers/GoogleWorkspaceProvider.php` to run that check in the existing
  WHMCS server Test Connection only when explicitly enabled in encrypted server configuration.
  Updated the module README and `tests/cloudhost247_email/run.php`. No migrations, customer
  routes, purchases, lifecycle actions or billing changes were added.
* The PHP WebAssembly mock harness passed 69/69 checks, including configuration failure,
  JWT scope/subject and 401 refresh. Mocks are not live evidence; no authorized Google
  reseller account or WHMCS staging was accessible or used in this phase. The reseller
  connection requires the authorized reseller administrator, enabled API, delegated readonly
  scope and service-account credential configured securely on the WHMCS server.
* Customer creation, subscriptions, seat and lifecycle management, WHMCS billing integration,
  dashboards and real API testing remain unimplemented. This is not production readiness.
  See Google documentation: https://developers.google.com/workspace/admin/reseller/reference/rest/v1/subscriptions/list


## Read-only subscription inspection (2026-11-08)

* Modified `lib/Providers/GoogleResellerConnection.php` in the existing email module to
  call `GET /apps/reseller/v1/customers/{customerId}/subscriptions/{subscriptionId}` using
  the already implemented read-only delegated authentication. It rejects malformed identifiers
  and incomplete subscription responses. This is a real API call when configured, but it has
  only been exercised with mock responses.
* Modified `modules/servers/cloudhost247_email_hosting/cron.php` to expose that lookup as a
  WHMCS-host CLI command, and documented it in the module README. This read-only diagnostic
  does not associate the remote subscription with a WHMCS service or synchronize database,
  billing, renewals or provisioning. Restrict its output to authorized operators.
* Added contract checks to `tests/cloudhost247_email/run.php`: 71/71 mock checks passed using
  PHP WebAssembly. No actual WHMCS lifecycle function, migration, customer creation,
  subscription creation, modification, or cancellation was implemented in this phase.
  No Google sandbox or WHMCS staging access was available for verification. Authorized reseller
  credentials and delegated readonly scope remain required. Purchase capability remains disabled.
