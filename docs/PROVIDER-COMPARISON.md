# Provider Comparison — Sandbox Readiness Before Any Activation

**Date:** 2026-11-07 · **Branch:** `arena/1b329121-cloudhost247` · **Status:** research/adapter-preparation only
**Constraint:** No service has been purchased, no live credential created, no provider activated, no payment gateway enabled, no webhook pointed at a live endpoint. **All sandbox work requires separate approval** once a provider and test account are chosen.

> Prices below are **indicative public list figures**, not quotes. They are recorded so the cost of a sandbox programme can be estimated; they must be re-verified against the provider's own pricing page before any purchase. **No purchase is authorised by this document.** Third-party sources were used only where an official page was not fetched; every such figure is marked `verify`.

## 0. What already exists in this repository (no new integration needed yet)

| Area | Existing implementation | Path |
| --- | --- | --- |
| Central provider catalogue (auth strategy, health check, credential fields, `used_by`, host allowlists) | 108 field definitions across ~30 providers | `modules/addons/cloudhost247_integrations/lib/Registry/ProviderCatalog.php` |
| Encrypted credential vault (AES-256-GCM, per-environment separation) | implemented | `modules/addons/cloudhost247_integrations/lib/Vault/EncryptedVault.php` |
| Infrastructure adapters (12–13 kinds, fail-closed registry, mock adapter disabled in production) | implemented, not live-verified | `cloudhost247-node/src/infrastructure/providers/**`, `platform/src/lib/providers/**` |
| Domain registrar adapters (GoDaddy, Namecheap, GoValue appraisal, RDAP) | implemented, not live-verified | `cloudhost247-node/src/domain-services/providers/**`, `platform/src/lib/domain-providers/adapters/**` |
| DNS propagation (Cloudflare / Route53, upstream-before-local, fail-closed) | implemented | `cloudhost247-node/src/dns/propagation.ts` |
| Payment gateway adapters (Stripe, PayPal, Paystack, Blockonomics) — **inbound webhooks only** | implemented, initiation deferred/frozen | `platform/src/lib/gateways/**`, `modules/gateways/**`, `cloudhost247-node/src/routes/webhooks.ts` |
| AI/LLM adapters (OpenAI-compatible `/chat/completions`, Anthropic-compatible `/v1/messages`) | implemented, unconfigured, fail-closed | `cloudhost247-node/src/builders/ai/llm-provider.ts` |
| FX providers (ECB, Frankfurter) with endpoint resolver | implemented | `modules/addons/cloudhost247_currency/lib/Providers/**` |
| Email/SMTP (SMTP client, cPanel SMTP, SendGrid, Microsoft Graph, Twilio, WhatsApp Cloud, Telegram, Slack) | catalogue + clients | `modules/addons/cloudhost247_integrations/lib/Api/**` |

**Conclusion:** the adapter *shapes* exist. What is missing is (a) approved test accounts, (b) sandbox credentials in the vault, (c) recorded sandbox round-trip evidence. A catalogue entry is not proof of a live integration.

---

## 1. Domain registrar

| Provider | API availability | Pricing (indicative, verify) | Sandbox access | Technical limitations | Integration requirements |
| --- | --- | --- | --- | --- | --- |
| **GoDaddy** | REST v1/v2, `developer.godaddy.com`; availability, purchase, DNS, privacy | Domain list prices vary by TLD; API itself no fee. Production API access has historically been gated on account size (reported 50+ domains for the availability API since 2024) `verify` [2](https://www.best-domain-registrars.com/best-domain-registrars-for-domain-apis/) | **Yes — OTE** `https://api.ote-godaddy.com`, separate OTE key/secret [1](https://domaindetails.com/kb/technical-guides/domain-api-integration-automation) | OTE is v1-only, so v2-only endpoints cannot be sandbox-tested; agreement keys must be fetched from `/domains/agreements` rather than hard-coded; rate limits require backoff on 429 [5](https://github.com/josuamarcelc/registrar-api/releases/tag/1.1.0) | `godaddy` vault entry (`username`/`api_secret`), IP allowlist where applicable, TLD price feed via provider response only — never hard-code TLD prices (`tests/security/test_domain_data_provenance.py`) |
| **Namecheap** | XML API, `namecheap.com/support/api` | Per-TLD retail pricing; API no separate fee. API access prerequisites reported as $50+ balance / 20+ domains / $50+ spend `verify` [1](https://domaindetails.com/kb/technical-guides/domain-api-integration-automation) | **Yes** `https://api.sandbox.namecheap.com` [1](https://domaindetails.com/kb/technical-guides/domain-api-integration-automation) | XML not JSON; IP allowlisting mandatory; several providers return HTTP 200 with an error body, so status-code-only success checks are unsafe [5](https://github.com/josuamarcelc/registrar-api/releases/tag/1.1.0) | `namecheap` adapter must parse XML error nodes; sandbox username + API key + registered client IP; contact profiles must be real (no placeholder registrant data) |
| **Cloudflare Registrar** | Registrar API + DNS API, `developers.cloudflare.com/api` | At-cost wholesale domain pricing (publicly documented); no separate API fee | **No registrar sandbox**; DNS API can be exercised against a disposable test zone | Registration is not available on all plans; no sandbox means registration cannot be end-to-end tested without a real (paid) domain | Use for DNS/CDN sandbox first; registrar only after explicit purchase approval |
| **Gandi** | REST v5 `https://api.gandi.net/v5` (already in the vault catalogue) | Per-TLD retail | Limited/no full sandbox; test organisation possible | Needs organisation/sharing-id scoping | `gandi` vault entry with personal access token; health check `GET /domain/domains?per_page=1` |
| **RDAP** | Public protocol (RFC 9083), no auth, `rdap.org` bootstrap | Free | N/A — read-only live data | Availability inferred from absence of an object is unreliable; never treat RDAP as authoritative availability | Keep as a WHOIS/reference adapter only (current design); do not use for purchase decisions |

**Recommendation for sandbox first:** Namecheap sandbox (full functionality, free, XML adapter already exists) + GoDaddy OTE (second opinion). Cloudflare for DNS only. **Registrar operations must call a real registrar API** — never a mock success.

---

## 2. VPS and dedicated infrastructure

| Provider | API availability | Pricing (indicative, verify) | Sandbox access | Technical limitations | Integration requirements |
| --- | --- | --- | --- | --- | --- |
| **Hetzner Cloud** | REST `https://api.hetzner.cloud/v1`, well documented | Entry VPS from a few €/month; **no free sandbox** — a test project creates real, billable resources | No separate sandbox; disposable project with prepaid credit is the closest substitute | Real charges accrue per hour; old Hetzner DNS Console API discontinued May 2026 — new Cloud API required [1](https://community.hetzner.com/tutorials/cert-manager-hetzner-cloud-dns-webhook/) | Project-scoped API token, billing cap, automatic destroy-after-test; `hetzner` adapter already present |
| **DigitalOcean / Vultr / Linode** | REST APIs | Usage-based hourly | No true sandbox; billable test droplets | idempotency on create is essential to avoid duplicate billable resources | Token + idempotency key + teardown job |
| **OVH / SoYouStart** | Signed OVH API (already implemented in `modules/servers/cloudhost247_ovh`, `soyoustart`) | Dedicated server monthly | No public sandbox; disposable OVH account required | Signed-request clock skew, region-specific endpoints, catalogue import must not invent prices (products created with `-1.00` sentinel per `docs/independent-rebuild/PRE-STAGING-REPORT.md`) | application key/secret/consumer key; staged mutations on a disposable account only |
| **AWS EC2 / Contabo / Proxmox / SolusVM / Virtualizor / OpenStack / Generic HTTP** | All present as adapters | Varies | Proxmox/OpenStack can be self-hosted free (real sandbox possible locally); others billable | Capability matrices differ; undeclared operations must fail closed (`tests/unit/provider-capability-truth.test.ts`) | Local Proxmox/OpenStack VM is the **cheapest genuine sandbox**; no live credentials needed |
| **Mock adapter** | Dev-only | Free | Yes | **Production-disabled**: requires `ALLOW_MOCK_PROVIDER=true`, explicit `mock` row, labels all resources `mock:true` / `mock-` | Use only in isolated test environments; never claim a mock resource is provisioned |

**Recommendation:** use a **self-hosted Proxmox/OpenStack** sandbox for provider-state mutation tests (zero external spend), then one Hetzner disposable project only after a spend cap is approved. **`platform/MIGRATION.md` §3 records that its order-driven provisioning path is still deferred** — that must be closed in the canonical stack before any provider test.

---

## 3. DNS and CDN

| Provider | API availability | Pricing | Sandbox access | Technical limitations | Integration requirements |
| --- | --- | --- | --- | --- | --- |
| **Cloudflare** | REST v4, `developers.cloudflare.com/api` | Free tier covers zones/DNS; CDN/WAF features on paid plans | **Yes — test zones on a free account**, no sandbox domain purchase needed | Zone must be delegated to Cloudflare nameservers; API tokens should be zone-scoped; propagation is eventually consistent | `cloudflare` vault entry (API token/account id); fail-closed `src/dns/propagation.ts`; `0055` zone/analytics/features tables |
| **AWS Route 53** | REST/SDK | Hosted zone + query charges (small) | No dedicated sandbox; disposable hosted zone is billable but cheap | Requires IAM-scoped credentials and SigV4; change propagation needs `GetChange` polling | `route53` adapter + IAM policy limited to the test zone |
| **PowerDNS** | Authoritative REST API (in vault catalogue) | Self-hosted, free | **Yes — full local sandbox** | Must be authoritative for the test zone; no global propagation | `powerdns` vault entry with `X-API-Key`; ideal for DNS-01 ACME tests |
| **Hetzner Cloud DNS** | New Cloud API (old `dns.hetzner.com` discontinued May 2026) | Bundled | Test zone on a disposable project | Legacy integrations break if pointed at the old endpoint [1](https://community.hetzner.com/tutorials/cert-manager-hetzner-cloud-dns-webhook/) | Token with write permission |

**Recommendation:** PowerDNS + Cloudflare test zone for the ACME/staging chain. No live CDN advertising until a rule-management test passes.

---

## 4. SSL certificate authority

| Provider | API availability | Pricing | Sandbox access | Technical limitations | Integration requirements |
| --- | --- | --- | --- | --- | --- |
| **Let's Encrypt (ACME RFC 8555)** | Directory-driven ACME v2 | Free | **Yes — staging directory** `https://acme-staging-v02.api.letsencrypt.org/directory` [1](https://community.hetzner.com/tutorials/cert-manager-hetzner-cloud-dns-webhook/) | Staging certificates are **not trusted** by browsers — must never be presented as a real SSL; production rate limits (duplicate certificate / failed validation) apply only on the production directory; HTTP-01 needs port 80 reachability, DNS-01 needs provider write access | ACME account key in vault, JWS signing, nonce handling, order/authorization/challenge state machine, DNS-01 via Cloudflare/PowerDNS adapter, certificate + chain persistence, renewal timer |
| **ZeroSSL** | ACME + REST | Free tier + paid | Limited | EAB credentials required for ACME | EAB kid/hmac |
| **Commercial CA / custom upload** | Vendor-specific | Paid | Varies | No automated issuance; upload path only | `src/routes/ssl.ts` already stores `issuer`, `challenge`, `certificatePem`, `autoRenew` — but **no ACME client exists** (Phase 1 finding `A11`/`F01`) |

**Critical honesty rule:** `src/routes/ssl.ts` is certificate **record CRUD**. Until an ACME client issues and a CA confirms, the UI must say "not configured", not "SSL installed". Sandbox certificates are staging-only and must be labelled as such.

---

## 5. Business email and SMTP

| Provider | API availability | Pricing (indicative) | Sandbox access | Technical limitations | Integration requirements |
| --- | --- | --- | --- | --- | --- |
| **cPanel UAPI (Email::*)** | WHM/cPanel API (in vault catalogue) | Included with cPanel licence | **Yes — staging cPanel account** (not yet available) | Requires licensed cPanel host; `createacct` is a real mutation | `whm`/`cpanel` vault entries, port allowlist 2087/2083, UAPI module allowlist |
| **Microsoft Graph (M365)** | Graph REST | Per-user/month licence | Developer tenant with free trial possible | App registration + admin consent; licence assignment required before mailbox works | tenant/client id/secret; `modules/servers/cloudhost247_email_hosting` |
| **Google Workspace** | Admin SDK/Directory API | Per-user/month | Trial tenant possible | Domain verification + OAuth service account | credentials in vault |
| **SMTP relay (SendGrid / Mailgun / generic SMTP)** | SMTP + REST | Free tiers exist | **Yes — sandbox/inbound-parse modes; no real recipient delivery** | Shared-IP reputation risk; anti-abuse required; must not send to real addresses in tests | `smtp`/`sendgrid` vault entries, sender-domain policy, SPF/DKIM/DMARC via DNS adapter, RFC 8058 one-click unsubscribe, suppression ledger |
| **cPanel SMTP** | SMTP | Included | Staging cPanel | Same as above | `cpanel_smtp` vault entry |

**Recommendation:** generic SMTP against a **local sink** (e.g. a catch-all dev mailbox) is the only zero-risk sandbox. Consent, unsubscribe and anti-abuse controls (`G15`/`G16`) must be tested before any real send.

---

## 6. AI and LLM services

| Provider | API availability | Pricing (indicative) | Sandbox access | Technical limitations | Integration requirements |
| --- | --- | --- | --- | --- | --- |
| **OpenAI-compatible** (`/chat/completions`) | REST | Token-based, varies by model | **No free sandbox**; usage is billed. Mock server is the only zero-cost option | Strict JSON output must be validated by section validators; timeouts/rate limits classified; never silently fall back to the built-in generator | `AI_LLM_BASE_URL`, `AI_LLM_API_KEY`, `AI_LLM_MODEL`, `AI_LLM_API_STYLE=openai`, `AI_LLM_TIMEOUT_MS` (`cloudhost247-node/.env.example:157-161`) |
| **Anthropic-compatible** (`/v1/messages`) | REST | Token-based | No free sandbox; mock server recommended | Separate request/response shape; same ledger/entitlement requirements | `AI_LLM_API_STYLE=anthropic` |
| **Self-hosted (Ollama / vLLM)** | OpenAI-compatible local endpoint | Compute cost only | **Yes — fully local, no external credential** | Model quality differs from hosted models; must be labelled as a local engine, not a production LLM | Point `AI_LLM_BASE_URL` at a local server; no credentials required — best sandbox for the AI builder |
| **Deterministic native engine** | In-process | Free | Yes | Rules-based, not an LLM; **must not be described as AI model output** | `src/ai-os/models/router.ts` defaults to it and fails closed for external engines |

**Recommendation:** local Ollama/vLLM against the existing `llm-provider.ts` contract, with a recorded mock server for CI. Ledger (`ai_site_generations`), entitlements (`src/builders/entitlements.ts`), permissions and audit logs must all be asserted before a hosted model is considered. `platform/` has **no LLM integration at all** — another reason it cannot be canonical.

---

## 7. Payment gateways — **FINANCIAL FREEZE APPLIES**

> You explicitly retained the freeze. Nothing in this section is authorised: no live gateway, no live webhook, no quarantined migration, no production payment setting, no real transaction. Sandbox work is described for planning only.

| Provider | API availability | Pricing (indicative, verify) | Sandbox access | Technical limitations | Integration requirements |
| --- | --- | --- | --- | --- | --- |
| **Stripe** | REST + Checkout/ PaymentIntent | ~2.9% + $0.30 per successful card charge in the US `verify` [5](https://supademo.com/product-demo/stripe-sandbox) | **Yes — Test mode**, keys `pk_test_`/`sk_test_`, documented test cards, isolated data [4](https://paymattic.com/stripe-api-keys/) | Card fields are cross-origin iframes; 3DS test flows need browser automation; webhooks must be signature-verified before any DB access [3](https://getautonoma.com/blog/payment-gateway-testing) | `stripe` vault entry (api_key, webhook_secret); test-mode keys only; local `stripe listen` to a staging URL |
| **PayPal** | REST Orders/Subscriptions | Per-transaction fee | **Yes — developer.paypal.com sandbox** with virtual buyer/seller accounts and webhook simulator [1](https://www.16idc.com/en-us/article-detail/payment-gateway-sandbox-testing) | Sandbox data periodically cleaned; plan-creation frequency limits | `paypal` vault entry (client_id, client_secret) |
| **Paystack** | REST | Local (NGN) per-transaction fee | **Yes — test keys** | Currency/region restrictions; NGN settlement rules | `paystack` test secret; **relevant to the NGN requirement** but no real NGN transaction authorised |
| **Blockonomics** | Bitcoin REST/callbacks | Network fees | Testnet only | BTC has 8 minor units — `platform/src/lib/money.js` documents that `NUMERIC(16,2)` cannot credit it and refuses by name | `blockonomics` vault entry; existing `modules/gateways/` module |
| **Manual / sandbox gateway** | Internal | Free | **Yes — already usable locally** | Cannot prove PSP behaviour | Current `SANDBOX_GATEWAY_WEBHOOK_SECRET` + `SANDBOX_PAYMENTS=true` in `platform/` |

**Recommendation:** keep all gateway work in test mode with mock webhook signatures and isolated PGlite/JSON stores. The inbound webhook parsers already exist in `platform/`; **checkout initiation is explicitly deferred** in `platform/MIGRATION.md` §4 and must be implemented in the canonical stack before any sandbox checkout. **No approval to enable anything is requested or assumed here.**

---

## 8. Cross-cutting integration requirements (all categories)

1. **Credentials** live only in the encrypted vault (`CH247_INTEGRATIONS_KEY`, `CH247_PLATFORM_ENVIRONMENT`) or environment variables; never in JSON metadata, audit logs, URLs or browser responses. The catalogue's `SENSITIVE_METADATA_TERMS` guard already enforces part of this.
2. **Fail closed.** Unconfigured/unknown providers must return a typed `CONFIGURATION_REQUIRED` / `UNSUPPORTED_OPERATION` error before any egress. Never fabricate a resource id, a provisioning success, a certificate, a mailbox or a domain.
3. **Sandbox-only evidence.** Every sandbox round trip records: provider, endpoint, request id, timestamp, environment tag (`sandbox`), and the provider's own response id. Staging certificates/resources must be labelled non-production.
4. **Cost controls.** Spend caps, automatic teardown, idempotency keys, and rate-limit backoff are prerequisites for any billable provider.
5. **No hard-coded prices.** Domain prices, plan prices and FX rates come from provider/whitelist feeds; `tests/security/test_domain_data_provenance.py` and the canonical-pricing design in `docs/MULTI-CURRENCY-ARCHITECTURE.md` enforce this.
6. **One adapter per capability.** Adapters are registered in `cloudhost247-node/src/infrastructure/providers/registry.ts` (canonical). Do not add a second implementation in `platform/`.

## 9. Decision needed

Select, per category, **which provider gets a sandbox account and a spend cap**. Until then all 16 rows in the feature register with status `Blocked by external provider` stay blocked, and no adapter is activated. Recommended zero-cost first set: **PowerDNS + Let's Encrypt staging + local Ollama + local SMTP sink + self-hosted Proxmox**, with **Namecheap sandbox / GoDaddy OTE / Stripe test mode / Paystack test keys / Cloudflare test zone** as the second, credential-gated set.

## 10. Sources

**Official / primary documentation (URLs for verification, not fetched in full during this phase):** `developer.godaddy.com`, `namecheap.com/support/api`, `developers.cloudflare.com/api`, `docs.hetzner.cloud`, `api.ovh.com`, `letsencrypt.org/docs`, RFC 8555, `platform.openai.com/docs/api-reference`, `docs.anthropic.com`, `docs.stripe.com`, `developer.paypal.com`, `paystack.com/docs/api`, `learn.microsoft.com/graph`, `developers.google.com/admin-sdk`.

**Secondary sources used only where an official page was not fetched (all figures marked `verify`):**
- [1](https://domaindetails.com/kb/technical-guides/domain-api-integration-automation) — registrar sandbox URLs and Namecheap access prerequisites.
- [2](https://www.best-domain-registrars.com/best-domain-registrars-for-domain-apis/) — GoDaddy availability-API account-size gate.
- [3](https://getautonoma.com/blog/payment-gateway-testing) — Stripe test mode vs sandbox, iframe/3DS limitations.
- [4](https://paymattic.com/stripe-api-keys/) — `pk_test_` / `sk_test_` key separation.
- [5](https://supademo.com/product-demo/stripe-sandbox) — indicative Stripe US card fee.
- [6](https://www.16idc.com/en-us/article-detail/payment-gateway-sandbox-testing) — PayPal sandbox accounts and webhook simulator.
- [7](https://community.hetzner.com/tutorials/cert-manager-hetzner-cloud-dns-webhook/) — Let's Encrypt staging directory; Hetzner old DNS Console discontinuation.
- [8](https://github.com/josuamarcelc/registrar-api/releases/tag/1.1.0) — registrar adapter pitfalls (HTTP 200 error bodies, agreement keys, endpoint differences).

**Internal evidence:** `docs/independent-rebuild/API-INVENTORY-AUDIT.md`, `docs/independent-rebuild/PRE-STAGING-REPORT.md`, `docs/independent-rebuild/EMAIL-MARKETING.md`, `platform/MIGRATION.md`, `modules/addons/cloudhost247_integrations/lib/Registry/ProviderCatalog.php`, `cloudhost247-node/.env.example`.
