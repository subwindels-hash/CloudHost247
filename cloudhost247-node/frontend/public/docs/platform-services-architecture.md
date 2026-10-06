# CLOUDHOST247 Platform Services — Architecture & Operations

The CLOUDHOST247 platform (the Node/TypeScript application in `cloudhost247-node/`) runs the domain,
hosting, website-building, AI-website, store, expert, marketing, logo, inbox and commerce services.
This document explains how those pieces fit together and what an operator must configure. It is
written to be read alongside `docs/DOMAIN_SERVICES_ARCHITECTURE.md` (the domain half, which predates
this document and is unchanged apart from the extensions listed below).

## 1. Module map

| Concern | Code | Notes |
| --- | --- | --- |
| Navigation (single source of truth) | `src/navigation/mega-menu.ts` | Drives the desktop mega menu, the mobile drawer, the footer, `GET /api/v1/navigation` and the generated sitemap. Validated by `validateNavigationTargets()` and the integration suite. |
| Packaged plans & pricing authority | `src/routes/admin-platform-services.ts`, migration `0071` | Only an admin may set a price; the public listing serves `published` rows only. |
| Website Builder | `src/builders/*`, `src/routes/builder.ts` | Typed sections, drafts vs immutable published snapshots, revisions, forms, SEO caps. |
| AI Website Builder | `src/builders/ai/*` | Provider registry (`rules` built-in, `llm`, `anthropic`), ledger per attempt, allowance from `getSiteLimits`. |
| Online Store | `src/store/*`, `src/routes/store.ts` | Products/variants/inventory, shopper checkout, fulfilment rules, digital delivery tokens. |
| Expert services | `src/experts/*`, `src/routes/experts.ts` | Requests, quotes, approval → order + invoice, delivery timeline. |
| Digital marketing services | `src/marketing-services/*` | Campaign engagements, channel-connection registry, sourced metrics only. |
| Logo Maker | `src/logo-maker/*` | Deterministic vector engine + optional AI palette suggestion. |
| Unified Inbox | `src/inbox/*`, `src/routes/inbox.ts` | Channel adapters as data, labels, assignment, internal notes, per-message delivery status. |
| Shared commerce bridge | `src/commerce/*`, `src/services/provisioning-service.ts`, `src/services/commerce-service.ts` | One cart, one checkout, one fulfilment dispatch. |
| Transactional email | `src/lib/transactional-email.ts` | Single transport; statuses are `sent`, `manual` or `failed` — never upgraded. |
| Public SEO surface | `src/routes/seo.ts` | `sitemap.xml` + `robots.txt` generated from the live definition and published content. |

## 2. Commerce: one path for every service

```
Product / Plan  →  Cart (cart_items | cart_service_items)  →  POST /api/v1/orders
                →  Order + order_items + Invoice + ledger entry (one transaction)
                →  verified payment (webhook or manual confirmation)
                →  provisionPaidOrder()  →  the owning module's fulfilment step
```

* **Prices are never accepted from the client.** A service line carries only a `serviceKind` and a
  `serviceRef`; the server re-reads the price at checkout and again at settlement.
* **`order_items.metadata` is server-set** and is the only bridge from money to infrastructure
  (`kind: platform_plan | expert_service | marketing_plan | domain_registration`). It is deliberately
  absent from every DTO.
* **Nothing provisions before payment.** Order creation alone never activates a plan; a checkout that
  cannot resolve a price is refused instead of guessed.
* **Idempotency everywhere it matters**: webhook events dedupe on `(provider, provider_reference)`,
  subscriptions on `(order, plan)`, inbox messages on `(conversation, external_message_id)`.

## 3. Provider abstractions

Registrar / availability / WHOIS, DNS, payments, email, AI model providers, marketing channels and
image uploads are each reached through an adapter interface. Two rules hold throughout:

1. **No mock or silent fallback.** If a provider is not configured, the caller gets a typed
   `CONFIGURATION_REQUIRED` (or an equivalent honest refusal); the platform never returns an invented
   availability, price, DNS record, delivery status or AI result.
2. **Swapping a provider is configuration**, not a code change: registrar credentials live in
   `domain_service_provider_credentials` (encrypted, `CREDENTIAL_ENCRYPTION_KEY`), channel
   connections in their own table, everything else in environment variables documented in
   `.env.example`.

## 4. Configuration checklist

| Variable / setting | Effect when unset |
| --- | --- |
| `DATABASE_URL`, `JWT_SECRET`, `APP_URL` | Application cannot start / sessions unsignable / links wrong |
| `CREDENTIAL_ENCRYPTION_KEY` | Registrar credentials cannot be stored or read |
| Registrar credentials (Admin → Domain Services) | Domain search, registration, transfer and auction settlement refuse with the missing provider named |
| `AI_LLM_BASE_URL`, `AI_LLM_MODEL`, `AI_LLM_API_KEY` | Built-in website generator and logo catalogue still work; AI requests are refused naming these |
| `NOTIFICATION_EMAIL_WEBHOOK_URL`, `NOTIFICATION_EMAIL_WEBHOOK_TOKEN` | Email queue stays visibly pending — delivery is never claimed |
| `INBOX_INBOUND_WEBHOOK_SECRET` | Inbound inbox endpoint answers 503 naming the variable |
| `STRIPE_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYSTACK_SECRET_KEY`, `SANDBOX_GATEWAY_WEBHOOK_SECRET` | Online settlement unavailable; orders use the manual/invoice flow and stores stay in `order_intake` |
| `MANUAL_PAYMENT_INSTRUCTIONS` | Manual-payment instructions are omitted from checkout |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_BASE_URL` | DNS automation unavailable (manual DNS remains) |
| `VITE_SITE_URL` | Only affects build-time metadata outside a browser; the deployed origin is used in the browser |

## 5. Operations

* **Migrations**: `npm run migrate` (additive, idempotent, ordered). `npm run migrate:status` and
  `npm run migrate:verify` report drift; `scripts/validate-migrations.py` validates the PHP tree's
  migrations too.
* **Worker**: background sweeps (transfer polling, auction deadlines, notification queue, inbox
  housekeeping, availability watches) run in the existing worker under the platform's lease system —
  schedule it on the deployment host (see `docs/CPANEL_DEPLOYMENT.md`).
* **Readiness**: `GET /health` is dependency-free liveness; `GET /ready` checks PostgreSQL and
  answers 503 when it cannot reach it.
* **SEO**: `GET /sitemap.xml` and `GET /robots.txt` are generated at request time (published sites and
  active stores only), so a draft is never advertised to a crawler.
* **Branding**: `scripts/branding-audit.py` must report 0 retired-brand matches before a release; the
  test suite repeats the check on the generated SEO files.

## 6. Known limits (stated, not hidden)

* No UI translation layer yet (multi-currency is supported per plan/store; domain names are
  internationalised). The UI does not claim otherwise.
* Auctions, brokerage and paid domain flows inherit the registrar/payment configuration: they are
  fully implemented but inert until an operator connects real provider credentials.
* Digital product files are stored and delivered by the platform; the media-upload sniffer accepts
  PNG/JPEG/GIF/WebP/PDF/ZIP/CSV/plain-text only, by magic bytes.
