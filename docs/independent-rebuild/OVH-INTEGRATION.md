# CloudHost247 OVH Integration

Version 1.1.0 — independent source implementation. Real OVH/WHMCS execution is **not verified**.

## Licensing and authentication boundary

This code does not load or modify WGS-OVH and has no vendor licence field or call. OVH authentication remains mandatory. It implements OVH's application-key/application-secret/consumer-key signing independently. Credentials are stored only in WHMCS encrypted server fields: username = application key, password = application secret, access hash = consumer key. Never commit credentials.

## Audited WGS-OVH feature inventory

The audit inspected readable addon/server PHP, hooks, templates and four cron scripts—not filenames alone. Observed API interactions include authenticated GET/POST/PUT/DELETE, time/signature generation, public eco catalogs, carts/items/configuration/checkout, order status/payment methods, dedicated and VPS lists/details/service info, availability, hardware, templates/reinstall/task status, monitoring, IP/reverse/move/firewall/mitigation, reboot/start/stop/terminate, snapshots/backup, IPMI, rescue/network boot and intervention history. Admin code covers account/consumer configuration, catalog/product groups, configurable options, margins/pricing, existing servers, orders, email/IMAP, ACLs and logs. Crons cover catalog/server import, IP status, price sync and email. Legacy tables are listed in the main audit.

| Original capability evidenced | CloudHost247 replacement | Status | API/runtime dependency / limitation |
|---|---|---|---|
| API accounts/regions | Endpoint maps to encrypted WHMCS server credentials; EU/CA/US allowlist | IMPLEMENTED source, BLOCKED runtime | Valid OVH app/consumer credentials |
| OVH request signing | `$1$` SHA-1 signature with `/auth/time` synchronization | IMPLEMENTED, unit-tested | OVH connectivity required |
| Generic GET/POST/PUT/DELETE | Signed client, validated paths, JSON validation | IMPLEMENTED, mocked | Live permissions unknown |
| TLS/timeouts/size limits | cURL peer/host verification, 5s connect, 30s request, 5 MB cap | IMPLEMENTED | Network verification blocked |
| Rate limits/retries | Retry-After handling; GET only retries 429/502/503/504 | IMPLEMENTED, mocked | Mutations intentionally not blindly retried |
| Secret-safe logs/errors | Path/status logging; no auth headers/body secrets; shared redaction | IMPLEMENTED/static-tested | Runtime log review blocked |
| Connectivity/permission test | Admin invokes authenticated `/me` | IMPLEMENTED source | BLOCKED |
| Eco/VPS catalog discovery | Public catalog endpoint, plan persistence and availability retirement | IMPLEMENTED source | API catalog shape/availability BLOCKED |
| Dedicated/VPS configuration options | Mapping stores allowlisted route plus validated JSON configurations | PARTIAL | Admin enters API-supported labels; automatic option discovery remains |
| Regions/datacenters/OS/storage/RAM/network | Raw plan JSON retained for supported API fields | PARTIAL | Dedicated normalization/UI not complete; do not infer unavailable fields |
| Product-to-WHMCS mapping | Validated product, endpoint, family, plan, subsidiary, config, active state | IMPLEMENTED source | WHMCS DB runtime BLOCKED |
| Product creation/configurable options | Existing WHMCS products are mapped, not auto-created | PARTIAL | Non-destructive design; automatic creation deferred |
| Pricing sync/margins | Margin retained on mapping; catalog currency retained | PARTIAL | No automatic `tblpricing` mutation; preview/apply workflow remains |
| Currency integration | Catalog currency is recorded; CloudHost247 currency is separate | PARTIAL | Cross-currency pricing apply remains |
| Cart/order provisioning | Cart, assign, item, configuration and checkout workflow | IMPLEMENTED source, BLOCKED | Exact plan/order route and OVH account permissions must be staged |
| Provisioning idempotency | Unique service/mapping key, persisted cart/item/order checkpoints | IMPLEMENTED/static-tested | Crash behavior/live checkout must be verified |
| Automatic payment | Not performed | NOT APPLICABLE by safety | OVH order may require operator payment/preferred method |
| Order-to-service completion | Order ID persisted | PARTIAL | Polling order details and automatic service-name binding remain |
| Existing-service linking | Binding table supports stable service name; sync skips unknown services | PARTIAL | Admin lookup/link UI remains |
| Status/details | Dedicated/VPS details and status | IMPLEMENTED source | Endpoint permissions BLOCKED |
| IP information | VPS IP and routed dedicated IP queries | IMPLEMENTED source | Response normalization/UI partial |
| Reboot | Dedicated/VPS reboot | IMPLEMENTED source | BLOCKED |
| VPS power/suspend semantics | VPS start/stop mapped to WHMCS suspend/unsuspend | IMPLEMENTED source | Stop is power state, not OVH billing suspension |
| Termination | Explicit WHMCS terminate action invokes supported endpoint | IMPLEMENTED source | Destructive runtime test requires disposable service |
| Reverse DNS | Legacy endpoints audited | PARTIAL/not exposed | Requires validated IP block/address workflow |
| Reinstall/rescue/snapshot/backup/firewall/IPMI/monitoring | Legacy API capability audited | NOT IMPLEMENTED | Product/permission dependent; must not be guessed |
| Service synchronization | Lists dedicated/VPS, updates only known bindings, counts unchanged/updated/failed/skipped | IMPLEMENTED source | BLOCKED runtime |
| Catalog synchronization | Idempotent upsert and unavailable marking | IMPLEMENTED source | BLOCKED runtime |
| Locked cron | CLI-only worker, endpoint leases, stale recovery and structured run counts | IMPLEMENTED source | Scheduling/runtime BLOCKED |
| Admin dashboard | Endpoints, test, catalog/service sync, mapping and recent operations | IMPLEMENTED source | Browser/runtime BLOCKED |
| Email/IMAP/ACL/order-form entitlement | Not required for core provisioning | NOT APPLICABLE | Can be reconsidered as independent optional features |

## Architecture

* `modules/addons/cloudhost247_ovh`: configuration, API, catalog, mappings, operations, synchronization and dashboard.
* `modules/servers/cloudhost247_ovh`: WHMCS provisioning/lifecycle callbacks.
* `crons/cloudhost247_ovh.php`: CLI-only read/sync worker.
* `mod_cloudhost247_ovh_*`: independent catalog, mapping, binding, operation, sync and lock records.

No WHMCS core file is changed. Synchronization updates only CloudHost247 binding rows. Provisioning is the sole flow that places an OVH order, and it requires an active explicit product mapping.

## Provisioning flow and recovery

1. Validate active WHMCS-product mapping.
2. Claim unique `provision:<service>:<mapping>` operation.
3. Create the binding as `ordering` before network mutation.
4. Create and immediately persist cart ID; assign cart.
5. Create and immediately persist item ID; add allowlisted configuration labels.
6. Checkout without automatic preferred-method payment and persist order ID/status `pending`.
7. Repeated WHMCS Create calls return the persisted operation instead of creating another cart.

Mutating requests are not automatically retried. A transport ambiguity is reported for reconciliation rather than blindly repeated. Automatic order polling/service-name binding is still partial and must be completed/verified before unattended provisioning.

## Installation and configuration

1. Use only a licensed WHMCS staging clone with backups. Activate CloudHost247 Foundation first.
2. Deploy addon, server module and CLI cron; activate CloudHost247 OVH to apply migrations 1.0.0 and 1.1.0.
3. In WHMCS Servers, create a `cloudhost247_ovh` server. Store application key in Username, application secret in Password, consumer key in Access Hash; choose region in module configuration.
4. In the addon, map an enabled endpoint to that WHMCS server and run **Test API**.
5. Sync a catalog, inspect raw supported plans, create a mapping to an existing disposable WHMCS product, then activate that mapping.
6. Test only with a designated OVH test/disposable account and explicit spending controls. Never test termination on a production service.
7. Deactivation retains mappings, operations and service bindings.

## Cron

```cron
23 */2 * * * /usr/bin/php /path/to/whmcs/crons/cloudhost247_ovh.php >> /path/outside/webroot/ovh-sync.log 2>&1
```

The cron performs read-only synchronization of known services. It does not provision, terminate, import unknown services, create WHMCS services or modify customer/financial records.

## Security

Admin changes require WHMCS administrator context and CSRF tokens. Regions, paths, product families, plan codes and subsidiaries are validated. TLS verification and redirect refusal are enforced. Authentication values and signatures never enter module logs. API errors expose bounded provider messages but not request headers. Destructive termination requires the explicit WHMCS terminate callback. Operators must issue least-privilege consumer-key rules for only the endpoint paths actually enabled.

## Tests and runtime requirements

Mock tests cover deterministic signatures, endpoint/path validation, authenticated headers, malformed JSON, rate-limit retries and secret exclusion. Static tests cover licensing independence, TLS, response limits, idempotency, non-destructive synchronization, admin/CSRF, financial-table protection and CLI-only cron.

Mocks do not prove OVH behavior. Required staging evidence includes exact WHMCS/PHP/database versions, API region and access rules, `/me`, catalog responses, mapping validation, cart/order behavior with a disposable product, ambiguous-failure reconciliation, order polling, service binding, status/IP/reboot/power, read-only sync, lock concurrency, audit redaction and rollback. Production readiness is not claimed.

## Parity completion update — 2026-09-27

Version 1.2.0 adds conservative normalization of hardware/CPU/RAM/storage/network/region/OS fields that actually exist in catalog payloads, persisted discovered options, normalized IP output, currency-rate-backed price previews, explicitly confirmed and audited product-price application, existing-service search/preview/confirm linking, pending-order polling, conservative service-name binding, reverse-DNS operations, and ambiguity checkpoints.

A transport failure during a remote mutation now enters `reconciliation_required`; repeated CreateAccount calls do not repeat that mutation. Cart and item IDs are checkpointed immediately. Where OVH returns a known order ID, polling queries status/details and binds only a returned `domain`, `serviceName`, or `serviceId`. Missing identities become `intervention_required`. If checkout may have succeeded but no order ID was received, automatic mutation remains stopped because safely discovering the order is region/account dependent; an administrator must reconcile rather than risk a duplicate.

Pricing keeps source price/currency, conversion rate, margin, rounding and final value separately. Applying a preview requires explicit confirmation, updates one allowlisted product billing-cycle column, and writes an audit record. It never changes generated invoices or transactions. Automatic source-price extraction is still PARTIAL because OVH catalog price shapes vary and must be verified per region/product.

## Source gap completion update

Version 1.3.0 adds recursive-but-conservative region/product normalization, an unambiguous source-price extractor, exact configurable-option suggestions and explicitly confirmed mappings to existing WHMCS options, unique cart-to-order discovery, deterministic order-resource resolution, ranked existing-service suggestions, and pure provisioning decisions for ambiguous failures. Multiple price candidates, multiple cart matches, multiple resource identifiers and non-exact option matches are rejected rather than guessed.

**IMPLEMENTED / automated or mock verified:** the owned normalization, ambiguity decisions, exact matching and validation behavior. **BLOCKED — STAGING REQUIRED:** actual regional payload fields, price units/currencies, order list/cart identifiers, WHMCS option schemas, permissions and all mutations. **NOT IMPLEMENTED — API/PRODUCT DEPENDENCY:** any advanced operation absent from the documented matrix.
