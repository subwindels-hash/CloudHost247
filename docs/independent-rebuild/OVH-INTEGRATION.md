# CloudHost247 OVH Integration

Version 1.5.0 — independent source implementation. Real OVH/WHMCS execution is **not verified**.

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
| Dedicated/VPS configuration options | `OptionValueExtractor` reads the selectable values out of the stored catalog payload (flat list, object list or key/label map; anything else is reported unverified) and `DiscoveredOptionMatcher` matches them exactly, at option and value level, against existing WHMCS options. The admin screen offers only exact suboption matches, and the mapping row records whether the catalog evidence proved it | IMPLEMENTED, mock-tested | Payload shapes vary per family and region; shapes the extractor does not recognise must be mapped by hand. The mapping is applied to WHMCS options, not synced to OVH |
| Regions/datacenters/OS/storage/RAM/network | `ProductSpecifications` maps the persisted catalog plan onto the eight specification fields, fills IPs by version from the plan's own address evidence, and names every field it cannot prove. `HostingProductManager::specificationPrefill()` shows the result read-only and save() records each field's provenance (`prefill`, `manual`, `not_verified`, V180) | IMPLEMENTED, mock-tested | A field the catalog does not carry stays empty and is labelled not verified; nothing is inferred from a plan code or name |
| Product-to-WHMCS mapping | Validated product, endpoint, family, plan, subsidiary, config, active state | IMPLEMENTED source | WHMCS DB runtime BLOCKED |
| Product creation/configurable options | `HostingProductManager::previewCreate()` resolves the plan read-only and `create()` writes it on explicit confirmation: one WHMCS product (created **hidden**), its hosting metadata with specification provenance, an **inactive** OVH mapping, and one `tblpricing` row per currency with every cycle and setup fee at `-1.00` (WHMCS's "cycle not offered" sentinel) so the product has no orderable cycle and no invented price. All four writes are one transaction, re-guarded inside it | IMPLEMENTED, mock-tested | No pricing is created - the confirmed `price_apply` flow sets it. Configurable-option groups are still not auto-created: discovered options are mapped to existing WHMCS options, so an operator keeps control of the option schema. Real `tblproducts`/`tblpricing` column constraints must be staged (see below) |
| Pricing sync/margins | Margin retained on the mapping; catalog currency retained on the preview; `price_apply` writes one allowlisted billing-cycle column per confirmed preview under `lockForUpdate`, rejecting a stale `current_price` | IMPLEMENTED, mock-tested | No **unattended** price mutation exists, and creation writes no price at all. OVH price shapes still vary per region and product, so automatic source-price extraction needs staging evidence |
| Currency integration | Catalog currency is recorded; CloudHost247 currency policy is separate; a cross-currency preview carries the source price, the conversion rate and the converted value, and the confirmed apply writes that converted value | IMPLEMENTED, mock-tested | Live currency-rate providers and the resulting provider quotes must be staged |
| Cart/order provisioning | Cart, assign, item, configuration and checkout workflow | IMPLEMENTED source, BLOCKED | Exact plan/order route and OVH account permissions must be staged |
| Provisioning idempotency | Unique service/mapping key, persisted cart/item/order checkpoints | IMPLEMENTED/static-tested | Crash behavior/live checkout must be verified |
| Automatic payment | Not performed | NOT APPLICABLE by safety | OVH order may require operator payment/preferred method |
| Order-to-service completion | Order ID persisted; polling resolves the delivered service name when OVH reports one. When it cannot, the binding becomes `intervention_required` and the admin screen offers a reasoned reconciliation: the operator supplies the exact service name against the order reference, with confirmation, uniqueness checks and an audit record (`ExistingServiceLinker::resolveIntervention`), which also completes the provisioning operation | IMPLEMENTED, mock-tested | Automatic resolution still depends on the region/account returning a resolvable identifier; the hand path exists precisely because it may not |
| Existing-service linking | Bounded, paginated read-only directory of what OVH owns with binding state, family/name filters and ranked WHMCS suggestions (exact domain or matching dedicated IP). Linking needs explicit confirmation; rebinding an existing binding is a separate confirmation that refuses a remote service another binding owns and is audited as `service.relink` with the previous identity | IMPLEMENTED, mock-tested | Ranking is a suggestion, never an automatic link: the operator chooses |
| Status/details | Dedicated/VPS details and status | IMPLEMENTED source | Endpoint permissions BLOCKED |
| IP information | VPS IP and routed dedicated IP queries | IMPLEMENTED source | Response normalization/UI partial |
| Reboot | Dedicated/VPS reboot | IMPLEMENTED source | BLOCKED |
| VPS power/suspend semantics | VPS start/stop mapped to WHMCS suspend/unsuspend | IMPLEMENTED source | Stop is power state, not OVH billing suspension |
| Termination | Explicit WHMCS terminate action invokes supported endpoint | IMPLEMENTED source | Destructive runtime test requires disposable service |
| Reverse DNS | Admin set/delete with IP-block/address/hostname validation, confirmation and audit | IMPLEMENTED source, BLOCKED runtime | Needs an IP block the OVH account owns |
| Snapshot / automated-backup status / task history / reinstall / rescue boot / IPMI access / monitoring | Admin-only `AdvancedOperations` (see below) | IMPLEMENTED source, BLOCKED runtime | Endpoint shapes follow OVH's public API reference; never exercised against a live account; consumer key needs matching rules |
| Firewall, network-boot beyond boot-id selection, intervention history | Legacy API capability audited; the vendor used all three | IMPLEMENTED, mock-tested | The call shapes follow OVH's published schema for these routes (`/ip/{ip}/firewall` and `/ip/{ip}/firewall/{ipOnFirewall}/rule`) but are unverified against a live account. Rule `action` (`permit|deny`) and `protocol` (`ah|esp|gre|icmp|ipv4|tcp|udp`) come from that schema, a port is a single number (OVH takes no ranges), a sequence is 0–19, and `ipOnFirewall` is an IPv4 scoped by the verified `/ip/{ip}` base, so a wrong value can only fail at the provider and can never reach another account. Firewall rule changes require the typed service name because they change network reachability |
| Automated-backup restore | The verified surface exposes backup *status* and, for VPS, a snapshot to revert to | NOT IMPLEMENTED | No automated-backup restore route is exposed on the surface this module is scoped to. Inventing one would risk a destructive mutation on an unverified path; the supported restore path stays `vps_snapshot_revert`, and `vps_backup_status` reports what the provider has. Confirming a provider restore route is a staging task, not a code guess |
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

## Source management layer update (2026-09-27)

**Project state: SOURCE DEVELOPMENT → STAGING PENDING.** CloudHost247 now includes additive source foundations for confirmed hosting-product metadata, pricing comparison evidence, redacted searchable audit events, currency policy administration, OVH operational filtering/reconciliation evidence, safe customer service states, and audited CMS mutations. WHMCS remains authoritative for products, pricing, billing, ownership, and authentication.

- **IMPLEMENTED (source):** CSRF/role checks, explicit confirmation for consequential writes, namespaced metadata, current-versus-proposed pricing evidence, one-use price previews with stale-price rejection, audit filtering/pagination, bounded operational queries, reconciliation guidance that does not automatically repeat uncertain mutations, localization/preview fallback, output escaping, and secret redaction.
- **PARTIAL:** Product specifications require runtime UI validation; operational next-sync/rate-limit visibility depends on persisted provider evidence; customer lifecycle buttons remain limited to operations already authorized by the server module; visual presentation needs browser evidence.
- **BLOCKED — STAGING REQUIRED:** real migrations/database transactions, WHMCS hooks and client area, browser/accessibility rendering, cron, currency HTTP providers, OVH authentication/API calls, provisioning and lifecycle operations.
- **NOT IMPLEMENTED — API/PRODUCT DEPENDENCY:** provider capabilities not exposed by an authenticated OVH product/API are not guessed; unsafe mutation retry is intentionally unavailable.

Migration ordering is core `1.1.0`, currency `1.0.0 → 1.1.0`, theme `1.0.0 → 1.1.0`, and OVH `1.0.0 → … → 1.6.0 → 1.7.0 → 1.8.0` (1.7.0 adds the option-mapping provenance flag, 1.8.0 the specification provenance column). All migrations are additive/idempotent and retain data on module deactivation. No WHMCS core schema is altered. Before upgrade, back up the database; rollback means restoring that backup and the prior source commit because additive tables/columns are deliberately retained.

## Discovery, specifications and reconciliation (version 1.5.0)

Three PARTIAL items from the parity matrix were completed in source:

**Automatic option discovery.** Catalog sync already stored each discovered option's
raw value. `OptionValueExtractor` now reads the selectable values out of it and
classifies the shape as `resolved`, `unverified` or `empty` — the module refuses
payload shapes it does not recognise instead of inventing a value list.
`DiscoveredOptionMatcher` (no database, no decisions) matches option names by
normalization, matches each value to a WHMCS suboption by the same rule, reports
ambiguity, and exposes one exactness rule that both the suggestion screen and the
confirmation path use, so they cannot drift apart. `ConfigurableOptionMapper`
confirms a mapping only through that rule and derives the new `verified` flag
(V170) from the evidence: a suboption confirmed against an unreadable payload is
recorded as unverified.

**Product specifications.** `ProductSpecifications` maps the persisted catalog
plan onto the eight specification fields the product editor stores — CPU, RAM,
storage, network, IPv4, IPv6, datacenter, operating system — filling only what the
payload proves and returning the list of fields it could not. The hosting-product
screen shows a specifications column and a "prefill from catalog" button that
writes nothing; saving records each field's provenance in V180's
`specification_sources_json` (`prefill`, `manual`, `not_verified`).

**Existing services and delivered orders.** `ExistingServiceLinker::directory()`
is a bounded, paginated, read-only view of what OVH owns: family and name
filters, binding state, and ranked WHMCS suggestions. Linking requires explicit
confirmation; rebinding a service that is already bound to a different remote
name requires its own confirmation and is audited as `service.relink` with the
previous identity, and a remote name owned by another binding is refused. For an
order that was delivered but whose service name could not be resolved
automatically, `resolveIntervention()` closes the loop by hand: the operator
supplies the exact name against the persisted order reference, the service is
bound, the provisioning operation is completed, and the action is audited as
`service.reconcile`.

Tests: `tests/ovh/run.php` (87 assertions) exercises the extractor, the matcher,
the prefill and the whole linking/reconciliation path against a join-capable
in-memory Capsule double in `tests/ovh/fakes.php`; `tests/ovh/test_static.py`
asserts the UI wiring, the capability split (reads stay on `operations.run`, the
reconciling write joins the apply set) and that both new migrations are additive.

## Automatic product creation (2026-10-02)

The last capability the vendor OVH automation had and this module did not was
creating WHMCS products. `HostingProductManager` now does it, one plan at a time,
in two steps that share a single resolver so a preview cannot promise what the
write then refuses:

1. `product_create_preview` (capability `operations.run`, read-only) resolves the
   plan and shows every value it would write: the product row, the hosting
   metadata, the mapping, the pricing columns, how many currencies would get a
   row, each specification field with its provenance, and the fields the persisted
   catalog payload does not prove.
2. `product_create` (capability `changes.apply`, explicit confirmation checkbox)
   writes all four records inside one transaction, re-checking both uniqueness
   guards inside it because another request may have claimed the plan or the name
   in between, then records one `product.create` audit event with the created
   shape.

What it deliberately does not do:

- **No bulk import.** The vendor automation walked a catalog and created every
  plan. This creates one plan per confirmed click, because each product is a
  customer-facing promise.
- **No invented specification.** A plan with no persisted `mod_cloudhost247_ovh_catalog`
  row is refused with "synchronize the catalog first"; nothing is inferred from a
  plan code or a product name. Fields the payload proves are filled through the
  same `ProductSpecifications` reader the prefill uses, and the rest stay empty
  and are recorded as `not_verified`.
- **No invented price.** Every billing cycle and every setup fee is written as
  `-1.00` - WHMCS's own "cycle not offered" sentinel, the value the vendor
  automation used and rewrote zero prices to. `0.00` is never written, because in
  WHMCS that means free. A pricing row that already exists is never overwritten.
- **Nothing orderable or provisionable until the operator says so.** The product
  is created `hidden`, its OVH mapping is created `active = 0` (activation is the
  existing, separate mapping decision, and the provisioning path only acts on an
  active mapping), `autosetup` defaults to off, and `servertype` may only be empty
  or this repository's own `cloudhost247_ovh` module - never a vendor module.
- **No duplicate.** The mapping table is unique on the WHMCS product, not on the
  plan, so the code guards both directions: one plan may be mapped to only one
  product, and a category may not gain a second product with the same name.
- **No new migration.** Only WHMCS core tables and existing module tables are
  touched, and no WHMCS core file changes.

Staging evidence still required: the exact `tblproducts` and `tblpricing` column
set and constraints of the live WHMCS version. The columns written here are the
ones the vendor's own production product-creation code used (plus
`specification_sources_json` from V180), which is repository evidence rather than
schema evidence; the transaction means a column the live schema rejects fails
loudly and leaves no half-created product behind, but it must be proven against a
real database.

## Advanced service operations (admin-only)

`lib/Services/AdvancedOperations.php`, surfaced in **Admin → Addons → CloudHost247 OVH → Advanced service operations**. It operates on a WHMCS service that is already linked to an OVH service name, and the action must match the linked family. There is no customer-facing entry point.

| Action | Family | OVH call (beneath the service base path) | Kind |
|---|---|---|---|
| Snapshot status / backup status / task history / templates | VPS | `GET /snapshot`, `/automatedBackup`, `/tasks`, `/templates` | read |
| Create snapshot | VPS | `POST /createSnapshot {description}` | write |
| Revert / delete snapshot | VPS | `POST /snapshot/revert`, `DELETE /snapshot` | **destructive** |
| Reinstall | VPS | `POST /reinstall {templateId}` | **destructive** |
| Task history / rescue boot options / IPMI status / compatible templates | Dedicated | `GET /task`, `/boot?bootType=rescue`, `/features/ipmi`, `/install/compatibleTemplates` | read |
| Monitoring on/off | Dedicated | `PUT <base> {monitoring}` | write |
| Select next boot | Dedicated | `PUT <base> {bootId}` (use the existing Reboot action afterwards) | write |
| IPMI access | Dedicated | `POST /features/ipmi/access {ipToAllow, ttl, type}` | write |
| Reinstall | Dedicated | `POST /install/start {templateName, details.customHostname}` | **destructive** |
| All boot options | Dedicated | `GET /boot` (every type, not only rescue) | read |
| Intervention history / detail | Dedicated | `GET /intervention`, `GET /intervention/{id}` | read |
| Select next boot (type/kernel) | Dedicated | `PUT <base> {bootId, bootType?, kernel?}` — `kernel` only with `netboot` | write |
| Addresses on the network firewall | VPS + Dedicated | `GET /ip/{ip}/firewall` (the `ipOnFirewall` entries) | read |
| Firewall rules | VPS + Dedicated | `GET /ip/{ip}/firewall/{ipOnFirewall}/rule` | read |
| Add / delete firewall rule | VPS + Dedicated | `POST /ip/{ip}/firewall/{ipOnFirewall}/rule {action: permit\|deny, protocol, source, destinationPort?, sourcePort?, sequence?}`, `DELETE .../rule/{sequence}` | **destructive** |

Address-scoped actions (the firewall, which lives in the `/ip` namespace rather than beneath the VPS or dedicated service base) can only name an address OVH itself reports for the linked service: `ServiceManager::boundAddress()` re-verifies membership before any call, so a request cannot address another account's block, the sub-path allowlist permits the dotted IPv4 but refuses any `..` segment, and reads that carry an identifier (`/intervention/{id}`, `/firewall/{ipOnFirewall}/rule`) build the path from validated values rather than from the request. Controls: CSRF token; `operations.run` capability for reads and `changes.apply` for writes; an explicit confirmation checkbox on every write; typing the exact OVH service name for destructive actions; strict validation of every field (numeric IDs, template-name pattern, IP address, hostname, closed IPMI ttl/type lists); the same ledgered, idempotent, never-auto-retried mutation path used for reboot and terminate (an uncertain outcome becomes `reconciliation_required`); and an audit event. Reverse-DNS set/delete in the same page are confirmed and audited too.

Staging evidence still required: each call against a disposable OVH VPS and dedicated server, with a consumer key limited to the paths used.
