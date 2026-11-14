# Microsoft 365 CSP reseller audit and implementation status

2026-11-08 · **Not production-ready. No CSP purchase or billing was activated.**

This is a repository audit, not a deployed WHMCS inventory or a Microsoft tenant test.
The deployed product configuration, permissions and any outside CSP provider are unknown.

## Existing implementation

* `modules/servers/cloudhost247_email_hosting/` is the WHMCS server module. The older
  `modules/servers/cloudhost247_email/` module this audit also examined was **removed on
  2026-11-14** (inactive and superseded); one email provisioning module remains. Do not add a
  second, and do not migrate existing products without a deployed-data inventory.
* `lib/Providers/Microsoft365Provider.php` authenticates to **Microsoft Graph** with
  client credentials. It can read the configured tenant's subscribed SKUs and perform
  individual user and licence operations. These are not CSP purchases, a partner product
  catalogue, customer onboarding, or reseller subscription management.
* WHMCS entry points in `cloudhost247_email_hosting.php` operate on mailboxes; `Renew`
  invokes `Reconciler::syncService`, not Microsoft subscription renewal. `functions.php`
  implements a user licence swap, not a CSP subscription upgrade or downgrade. Its
  package-change implementation lacks a per-service lock and a durable per-step operation
  ledger. Treat package changes as requiring staging review before use.
* `lib/Service/PublicCatalog.php` reads existing WHMCS products/prices and links to the
  WHMCS cart. This is not evidence that an order buys a Microsoft subscription, or that
  payment, tax, renewals and country availability have been verified end to end.
* `templates/overview.tpl`, `lib/Service/ClientAreaPresenter.php`, and the admin service
  tab offer mailbox-level controls and information. They are not CSP customer/admin
  subscription dashboards. `DnsService.php` and the Graph adapter can retrieve configured
  tenant DNS details but do not onboard CSP customers.
* `OperationRepository.php`, `Lock.php`, `Logger.php`, `Reconciler.php`, existing WHMCS
  currency and notification facilities provide potential building blocks. Their existence
  does not provide exactly-once CSP purchasing or WHMCS subscription synchronization.
* Repository search for Partner Center/CSP API implementations found no existing partner
  purchasing integration. No provider authorization was found or verified.

## Feature-by-feature status

| Requested feature | Status | Evidence / outstanding work |
| --- | --- | --- |
| CSP catalogue and plans | Missing | Graph `subscribedSkus` lists an existing tenant's holdings, not CSP market offers or prices. WHMCS product configuration exists but is not an authorized CSP catalogue. |
| CSP purchasing | Missing | Partner Center or an authorized indirect provider API, agreements and consent required. |
| WHMCS orders/invoices | Partial | Ordinary WHMCS cart and product pricing exist; there is no CSP-specific payment-to-purchase chain or verified invoice test. |
| Renewal/billing synchronization | Missing | Mailbox sync is not a provider renewal. Financial periods, partner commitments and WHMCS invoices require explicit reconciliation. |
| Licences and quantity | Partial | Graph assigns/removes individual tenant licences; it cannot purchase seats or manage CSP quantities. |
| Subscription changes/cancellation | Missing | Mailbox operations and Graph licence swaps are not subscription actions. |
| Customer dashboard | Partial | Mailbox overview only; no subscription/seat lifecycle. |
| Admin/super admin | Partial | Existing WHMCS service tab; no CSP catalogue, operations, billing, health, RBAC-controlled secret administration. |
| Tenant and domain onboarding | Partial | Existing tenant/domain reads and DNS guidance; no CSP onboarding, consent or tenant creation. |
| Notifications | Missing for CSP | WHMCS has notifications, but no CSP lifecycle/renewal events are wired and tested. |
| Recovery/idempotency/audit | Partial | Mailbox locks, ledger and logs exist; CSP purchase claims, replay, uncertain outcomes and renewal reconciliation are absent. |
| Country/currency | Partial | Existing WHMCS catalogue/currency components, not CSP market availability and synchronized pricing. |
| CSP sandbox / WHMCS staging verification | Not performed | No authorized CSP sandbox or WHMCS staging environment provided. |

## Safety upgrade in this pass

`modules/servers/cloudhost247_email_hosting/functions.php` no longer reports a licence
swap successful when old-licence removal fails; it flags manual reconciliation, including
uncertain assignment. `lib/Service/Reconciler.php` does not clear those package-change flags
from a generic user status read. This is a safety measure, not a complete or fully
idempotent swap workflow. Database-backed and concurrency tests are still required. Existing
Google and Microsoft conflict/partial-create protections remain in place. No schema change.

## Architecture and implementation plan

1. Confirm whether CloudHost247 is a direct CSP or an indirect reseller and identify the
   authorized provider, supported markets, Partner Center/indirect API, CSP test tenant and
   WHMCS staging product/service assignments. Keep Graph credentials and CSP partner
   credentials separate; never embed either in frontend code or logs.
2. Extend the existing module and its versioned migrations rather than create a parallel
   WHMCS module or billing system. Persist partner customer/tenant, product/SKU/availability,
   cart, order, subscription, term, currency and operation identifiers separately from
   `accounts.remote_id` (which identifies a Graph user). Define unique constraints and
   transactional operation claims, durable request IDs and ambiguous-outcome reconciliation.
   Inspect deployed schema before writing migration or performing data migration.
3. Import or configure only authorized, market-specific product availability and prices;
   map them to real WHMCS products/configurable seat options, currency and billing cycles.
   WHMCS remains the source of customer invoices, taxes, payments and credits. Partner
   prices/currency and commitment terms must not be rewritten by display conversion.
4. Build separately authenticated provider adapters and onboarding/consent workflows.
   Purchase only after confirmed WHMCS payment and explicit provisioning policy. Preserve
   immutable financial snapshots, recover uncertain responses using provider IDs and safe
   idempotency semantics, and never repeat a potentially chargeable request blindly.
5. Add subscription state/quantity/renewal sync, provider-authorized changes, RBAC-backed
   admin/customer views, DNS guidance and notifications only as real service operations
   become available. Reconcile provider commitments independently of WHMCS payment status.
6. Test against mocked contracts and WHMCS database fixtures first, including simultaneous
   requests, timeout-after-send, callbacks, proration and duplicate renewals. Then use an
   authorized Microsoft CSP integration sandbox and WHMCS staging, without chargeable
   transactions unless explicitly authorized. Verify permissions, MFA/consent, markets,
   renewal terms, cancellations and recovery with the actual provider.

Microsoft's [Partner Center API overview](https://learn.microsoft.com/en-us/partner-center/developer/get-started)
describes a separate integration sandbox and notes app+user MFA enforcement since April 2026;
[authentication guidance](https://learn.microsoft.com/en-us/partner-center/developer/partner-center-authentication)
describes Partner Center-specific authentication. The documented
[cart checkout](https://learn.microsoft.com/en-us/partner-center/developer/checkout-a-cart)
is idempotent per cart, while individual operations must be reviewed for their own guarantees;
[subscription updates](https://learn.microsoft.com/en-us/rest/api/partner-center/manage-orders/update-subscription-by-id)
document request IDs and optional ETags. Do not infer that those guarantees cover WHMCS
invoices or every other provider endpoint.

## Verification and blockers

No live API verification, purchases or WHMCS integration testing were performed. The PHP
mock diagnostics exercise tenant-user adapter behavior, not CSP operations or WHMCS payment
workflows. Completion requires an authorized provider and supported CSP sandbox, verified
catalogue/terms, secure secret storage and consent, a WHMCS staging system and production
configuration; the missing code also must be implemented and tested. Until then this is not
a complete reseller module and must not be marketed as one.

## Subsequent operation-ledger hardening

The existing mailbox operation repository now uses a conditional failed-state and attempt-count
update when claiming retries; stale sweeps only transition operations still in progress and
still stale. Locks use a distinct acquisition owner and release only that owner's row. These
changes are used by existing WHMCS mailbox workflows; they do **not** implement CSP ordering
or prove exactly-once financial behavior. `tests/cloudhost247_email/operation_database.php`
exercises seven cases with SQLite and a small WHMCS query adapter, including a simulated retry
race and successor lock. The 66 mock diagnostics also pass. Neither suite verifies real
WHMCS/MySQL behavior, real concurrency, payment handling, Partner Center, nor CSP sandbox
operations. The database integration and all missing CSP components remain production blockers.
