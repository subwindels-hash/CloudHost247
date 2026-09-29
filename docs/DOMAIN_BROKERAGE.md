# Domain Brokerage

The Node platform's Domain Brokerage Engine is provider-neutral. `src/domain-brokerage/provider.ts` defines the adapter contract and capability registry; database provider rows are not considered connected until a real health check succeeds. No GoDaddy, Sedo, Afternic, or DomainAgents adapter is enabled in this checkout because credentials/partner access are not configured.

## Legitimate workflow

Customers can submit a confidential-budget case at `/api/v1/account/domain-brokerage/cases`. The maximum budget is never returned to provider/owner-facing DTOs. The default acquisition route is `manual_broker_required`; a registered domain is not represented as available for sale. Customer records are owner-scoped, and admin case access is role-gated.

Offer rows and event rows are append-only. Payment and transfer tables only record externally confirmed states; this module does not create fake escrow, payments, provider connections, owner contacts, or transfer confirmations. Existing payment infrastructure remains the payment system of record. A production provider adapter must use the central API & Integrations secret vault and redact credentials from logs.

## Provider access checklist

| Provider | API/brokerage access | Enabled |
|---|---|---|
| GoDaddy | Availability/registrar operations require configured API credentials; aftermarket access may require partner/allowlist access | No |
| Sedo | Marketplace/brokerage access requires an authorized service/API agreement | No |
| Afternic | Access and brokerage operations may require commercial/partner approval | No |
| DomainAgents | Acquisition/broker workflow requires authorized provider access | No |
| Manual CloudHost247 | Legitimate public/registrar forwarding/manual outreach | Route available, no fake connection |

Configure and test a provider through the central integration system before setting its database status to `connected`. Provider capability flags must match tested operations.

## API areas

- Customer: domain brokerage status, create/list/detail cases, customer offers and messages.
- Admin: paginated/filterable cases, assignment, provider management, and real-data overview counts.
- Database migration `0026_create_domain_brokerage.sql` creates cases, assignments, offers, messages, events, payments, transfers, documents, providers, and audit logs with foreign keys, indexes, status checks, immutable event/offer history, and case idempotency keys.

This implementation is staging-ready as an unconfigured/manual workflow; it is not a claim that any third-party provider is connected or that a transfer has completed.
