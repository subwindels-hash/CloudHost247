# Domain Services Platform — Architecture Audit and Delivery Plan

## Scope and safety boundary

This document records the Phase 1 audit and data/provider architecture for the Domain Services
platform. It deliberately does **not** present a search box, price, availability, registration,
transfer, auction bid, appraisal, or WHOIS result until it is backed by an actual configured
provider or an authoritative database transaction.

No migration in this change is applied automatically. Production migration remains an explicit
operator action through the existing migration runner, after a backup and review.

## Existing architecture reused

| Existing component | How Domain Services uses it | Not duplicated |
| --- | --- | --- |
| `customer_domains` + `application_domains` | The canonical customer-owned/manageable domain record and existing DNS/SSL/app attachment flow. A registrar-confirmed registration/transfer links to it only after confirmation. | A second `domains` table |
| Catalog, carts, `orders`, `invoices`, `payments`, verified webhooks | All domain charges use the existing server-priced checkout and verified settlement path. | A separate payment system or client-asserted payment completion |
| `subscriptions` | Domain Club membership billing lifecycle. | A standalone membership billing engine |
| RBAC (`authenticate`, `requireRole`) | Customer ownership boundaries and Super Admin provider administration. | New authentication / role models |
| `audit_logs` and request audit context | Provider config changes, domain workflows, auctions and broker actions. | A competing audit log system |
| `user_notifications` + notification outbox | Registration, transfer, auction, appraisal, broker and membership notices. | A new email sender |
| `domain_broker_*` | Existing brokerage cases, offers, internal/customer messages, assignments, payments, transfers and audit history. | A second broker-request model |
| Credential encryption/key rotation (`lib/crypto`, `lib/keyring`) | Provider credentials, EPP codes, and domain-contact payloads are AES-256-GCM encrypted at rest. | Plaintext provider/API-secret storage |

The existing Domain Brokerage module is operationally related but is not a registrar integration:
it correctly records a customer acquisition request without claiming the registrant will sell. The
new domain services model complements it; it does not replace those case-management tables.

## Phase 1 foundation

Migration `0063_create_domain_services_foundation.sql` supplies forward-only, transactional schema
for the remaining workflows:

- `domain_service_providers` and write-only encrypted `domain_service_provider_credentials`
- provider-sourced `domain_extensions` and `domain_provider_extension_offerings`
- authoritative search history/results and bounded bulk-search records
- encrypted `domain_contacts`, registration records, and transfer records
- privacy-respecting appraisal and RDAP/WHOIS lookup records
- auction/bid tables with an ordered bid sequence and idempotency constraint
- Domain Club plans/memberships
- `domain_transactions`, which references the existing order/invoice/payment records rather than
  inventing a parallel payment ledger

`domain_registrations` only becomes `registered` after a provider confirms it. Likewise, a
transfer becomes `completed` only after the registrar/registry confirms it. The payment webhook
will be the sole path allowed to advance payment-gated jobs in subsequent phases.

## Provider abstraction

`src/domain-services/providers/types.ts` defines the normalized `DomainProviderAdapter` boundary:

- availability and pricing
- extension catalogue
- registration and transfer initiation
- provider-side status confirmation
- public, privacy-respecting domain information
- appraisal
- live connection testing

Every operation must either call the concrete provider API or reject with a typed provider error.
The registry in `src/domain-services/providers/registry.ts` intentionally has **no generic HTTP
fallback and no mock adapter**. An uncompiled adapter or absent connection-tested account yields
`Service Provider Not Configured`, never manufactured availability, price, WHOIS, comparable sale,
or transaction state.

`resolveConnectedDomainProvider()` requires all of the following before an adapter can be used:

1. a provider record exists for the capability;
2. its status is `connected` after a real connection test;
3. encrypted credentials are present and decrypt under the configured key ring; and
4. the matching adapter is compiled and registered.

This separation means changing registrar, RDAP, or appraisal vendors later affects one adapter and
configuration record, not routes, payments, or dashboard state.

## Provider credentials needed before services can be activated

The exact API fields depend on the selected vendor, but Super Admin configuration will require a
contracted account and the provider’s production or sandbox credentials:

| Capability | Required provider/API capability | Required configuration |
| --- | --- | --- |
| Search, pricing, registration, transfer | ICANN-accredited registrar/reseller API with availability, price, contact, EPP transfer, and operation-status endpoints | Account/API key/secret or OAuth credentials, API base URL, environment, supported-TLD authorization, and any IP allowlist |
| RDAP | RDAP service with acceptable request limits, or the relevant registry RDAP bootstrap endpoint | Base URL/optional credentials and request-rate policy |
| Appraisal | A licensed domain-valuation API that returns valuation factors and any public comparables | API credentials, price/usage limits, and terms allowing display/storage |
| Auctions | Internal inventory/auction policy initially; external marketplace integration only when its seller, escrow and transfer API contract is approved | Marketplace credentials and a settlement/escrow process, if used |
| Brokerage | Existing manual-broker workflow, plus optional approved marketplace/broker provider | Provider credentials only where an approved connection actually exists |

No credentials have been added, no provider test has run, and no live API/resource call is made by
this Phase 1 work.

## Controlled delivery sequence

1. **Phase 1 (this foundation):** audit, migrations, encrypted provider configuration model and
   provider abstraction.
2. **Phase 2:** connect one approved registrar adapter; synchronize its TLD offerings; build
   provider-confirmed search and extensions directory with `Provider Not Configured` states.
3. **Phase 3:** registration quote/cart/order flow; verified settlement queues provider work;
   provider confirmation creates/links `customer_domains`.
4. **Phase 4:** EPP transfer workflow, encrypted auth codes, polling/confirmation and customer/admin histories.
5. **Phase 5:** RDAP-first privacy-preserving lookup and bounded/batched bulk search.
6. **Phase 6:** appraisal only after a real valuation provider is configured.
7. **Phase 7:** auction lifecycle, locked transactional bidding, notifications and winner settlement.
8. **Phase 8:** Domain Club plan configuration and membership settlement through subscriptions.
9. **Phase 9:** extend the existing broker module, not a duplicate workflow.
10. **Phases 10–12:** dashboard/admin pages, notifications, audit coverage, abuse controls,
    responsive/e2e/security testing.

## Important implementation rules for all later phases

- All identifiers, prices, discounts, extension support and provider metadata are resolved server-side.
- Contact data, EPP codes, and provider credentials are encrypted and never returned by APIs.
- Bulk search has a hard server-side size cap and controlled provider batching; it cannot fan out
  unbounded registrar requests.
- Auction bids are created only under a transaction lock on the auction row; the database’s unique
  `(auction_id, bid_sequence)` and bid idempotency index are backstops, not UI conventions.
- RDAP/WHOIS history stores a public projection only. Privacy-protected registrant information is
  reported as unavailable, never inferred or bypassed.
- Customer queries are always scoped by authenticated user ID. Staff/admin access is separately
  RBAC-protected and audit logged.
- Provider errors are separate from availability/registration states and are rendered as safe
  customer messages while technical context remains server-side.
