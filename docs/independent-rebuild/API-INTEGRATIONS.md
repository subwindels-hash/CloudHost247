# API & Integrations

CloudHost247 configures **every** external API the platform calls from one place:
**Admin → Addons → CloudHost247 API & Integrations**.

There is no second configuration system, no credential in a template, a product
option, a log line or the Git repository, and no integration listed in the
dashboard that lacks a real backend and a real connection test.

---

## 1. Architecture

```
Integration  ->  Provider    ->  Credentials       ->  Configuration  ->  Health check   ->  API client
(one row per     (registry       (AES-256-GCM in       (endpoint,         (documented       (IntegrationClient
 provider +       definition)     the secret table)     region, version,   read-only call)   or a module's own
 environment)                                           timeouts, retry)                     hardened client)
```

| Layer | Class | Responsibility |
|---|---|---|
| Provider registry | `lib/Registry/ProviderRegistry.php`, `ProviderCatalog.php` | Declares every supported provider: fields, authentication strategy, endpoint policy, health check, scopes, documentation. |
| Field contract | `lib/Registry/FieldDefinition.php` | One field definition per input, so each screen shows only the fields that provider really needs. |
| Credentials | `lib/Security/MasterKey.php`, `SecretVault.php` | Envelope encryption of every secret, bound to its integration row and field. |
| Endpoint boundary | `lib/Security/UrlGuard.php` | HTTPS-only, allowlisted, anti-SSRF validation of administrator supplied endpoints. |
| Configuration store | `lib/Services/IntegrationRepository.php` | The only class that reads or writes credential material. |
| Runtime resolution | `lib/Services/IntegrationManager.php` | Resolves the active configuration for the current environment at call time. |
| Health check | `lib/Services/ConnectionTester.php`, `lib/Api/SmtpProbe.php` | Executes the documented provider test server-side and reduces it to one safe classification. |
| API client | `lib/Api/IntegrationClient.php`, `lib/Api/Signers/*` | Applies the provider's authentication protocol, timeouts and retry policy. |
| Administration | `lib/Services/AdminController.php`, `AdminView.php` | Super Admin screens, CSRF, capabilities, confirmations and audit records. |

**Adding a provider** means adding one `ProviderDefinition` to the catalogue (or
calling `ProviderRegistry::register()` from another module's bootstrap). The
dashboard, the configuration screen, the connection test, the event history and
the runtime client factory all pick it up with no further changes.

---

## 2. Deployment prerequisites

| Variable | Required | Purpose |
|---|---|---|
| `CH247_INTEGRATIONS_KEY` | **yes** | Master key for credential encryption. 32 or more random bytes, supplied as hex, base64 or a long passphrase. Read from the environment, or from `$ch247_integrations_key` in `configuration.php`. |
| `CH247_PLATFORM_ENVIRONMENT` | recommended | `development`, `staging` or `production`. When unset the platform assumes `production`, which is the safe default but hides genuine environment separation — set it explicitly on every non-production server. |
| `CH247_INTEGRATION_ALLOW_PRIVATE_HOSTS` | no | Set to `1` only when an integration must reach an RFC1918 control panel (for example an internal WHM host). Private, loopback, link-local and reserved addresses are rejected otherwise. |
| `CH247_RDP_ALLOWED_HOSTS` | yes for RDP | Retained second boundary in the RDP server module: the central endpoint must also be on this allowlist. |

Generate a key with:

```
head -c 32 /dev/urandom | base64
```

Store it in the deployment environment (systemd unit, PHP-FPM pool, container
secret). **Never** commit it, and never place it in a web-accessible file.
If the key is missing the vault fails closed: credentials cannot be saved,
decrypted or used, and the dashboard shows a configuration error rather than
falling back to a weaker key.

---

## 3. Data model

| Table | Contents |
|---|---|
| `mod_cloudhost247_integrations` | One row per provider **per environment**: display name, endpoint, region, API version, account id, user name, timeouts, retry policy, enabled flag, status, last check / success / failure timestamps, last sanitized failure reason, created and updated audit columns. Unique on `(provider_key, environment)`. |
| `mod_cloudhost247_integration_secrets` | One row per credential field: the AES-256-GCM envelope, cipher name, master-key fingerprint, value fingerprint, who rotated it and when. No plaintext, ever. |
| `mod_cloudhost247_integration_events` | Sanitized health-check and runtime-failure history: result code, outcome, latency, short detail text, correlation id, administrator id. No provider payloads. |

All three tables are created by an additive, `hasTable`-guarded migration
(`migrations/V100.php`, version `1.0.0`). Deactivating the addon retains all
data.

---

## 4. Security model

**Storage.** Every secret is encrypted with AES-256-GCM using a 12-byte random
IV per write. The envelope format is `v1.<iv>.<tag>.<ciphertext>`, and the
additional authenticated data binds the ciphertext to
`cloudhost247|<integration id>|<field key>|<master key fingerprint>`. A stored
value therefore cannot be replayed into another provider, another environment or
another credential slot, and a ciphertext copied between installations will not
authenticate.

**Key handling.** The master key never enters the database or the repository.
It is read from deployment configuration and stretched with HKDF-SHA256 before
use. Rotating the deployment key changes the key fingerprint; every credential
encrypted with the previous key is flagged in the UI as
*"Encrypted with a previous master key — replace this credential"* so the
operator knows exactly what to re-enter.

**Exposure.** Plaintext exists only inside `IntegrationRepository::secrets()`
and the object that makes the outbound call. Specifically:

- Secrets are **never** rendered into HTML. Credential inputs are always empty
  password fields; a stored credential is shown as `••••••••••••` plus the first
  eight characters of a keyed, non-reversible fingerprint and the rotation date.
- The administration screens emit **no JavaScript at all**, so no credential can
  reach a browser script.
- Secrets are **never** placed in a URL or a query string. Where a provider
  protocol mandates otherwise (Telegram bot tokens are a path segment, SMM
  panels take the key as a POST field) the credential goes in the path or the
  request body, and that is documented per provider below.
- `Redactor` strips query strings from URLs and replaces the value of any
  `Authorization`, `X-Api-Key`, `X-Ovh-*`, cookie or token header before
  anything is logged.
- `SafeError` and the shared `AuditLogger` (with `SecretPolicy::redact`) mean no
  exception message, stack trace or provider body can reach an administrator
  page, an email or the log.
- `.gitignore` already excludes `.env*`, `*.pem`, `*.key` and `configuration.php`.

**Endpoints.** Administrator-supplied endpoints go through `UrlGuard`: HTTPS
only, at most 512 characters, no whitespace, no embedded credentials, no query
string or fragment, no `..`, optional host and port allowlists per provider, and
private, loopback, link-local and reserved IP literals blocked unless the
deployment explicitly opts in. The HTTP transport disables redirects, enforces
peer and host certificate verification, and caps the response body at 1 MiB.

**Access control.** Every screen requires an authenticated WHMCS administrator
(`AdminGuard::requireAdmin`), every state change requires a valid CSRF token
(`AdminGuard::requirePostToken`), and each operation checks its own capability:

| Operation | Capability |
|---|---|
| View the dashboard, catalogue and events | `integrations.view` |
| Create an integration | `integrations.create` |
| Edit an integration | `integrations.edit` |
| Change a production endpoint or region | `integrations.endpoint` |
| Replace a credential | `integrations.rotate` |
| Enable or disable an integration | `integrations.toggle` |
| Run a connection test | `integrations.test` |
| Delete an integration | `integrations.delete` |

Capabilities are restricted to WHMCS role IDs under **CloudHost247 Foundation →
Administrator role capabilities**. With no policy the normal WHMCS addon
authorization applies. Every create, update, enable, disable, rotate, test and
delete is written to the CloudHost247 audit log with the administrator id, the
before and after non-secret values, the result and, for failures, a sanitized
reason.

---

## 5. Test vs production

Each provider is configured **once per environment**, and the pair
`(provider, environment)` is unique. The environment the running application
uses is resolved server-side from `CH247_PLATFORM_ENVIRONMENT` only — never from
a request parameter — so a staging server cannot pick up production credentials
by accident.

- The banner at the top of every screen states the environment being viewed, the
  environment this deployment reports, and warns when they differ.
- Saving, enabling, rotating or testing a **production** configuration requires
  ticking an explicit confirmation on that submission. There is no "remember my
  choice".
- Providers whose credentials are self-describing are checked declaratively. A
  Stripe production integration must use an `sk_live_` key and a non-production
  one must use `sk_test_`; Onfido production tokens must contain `api_live` and
  sandbox tokens `api_sandbox`. Violations are rejected at save time with a clear
  message.
- PayPal resolves a different documented host per environment
  (`api-m.sandbox.paypal.com` vs `api-m.paypal.com`) so a sandbox configuration
  physically cannot reach the live API.

---

## 6. Connection testing

Press **Test** on the dashboard or **Run connection test** on a configuration
screen. The test runs entirely on the server, using the stored credentials, and
performs the read-only call documented for that provider (listed per provider in
section 9). SMTP is tested with a real submission handshake — greeting, `EHLO`,
`STARTTLS` when configured, `AUTH LOGIN`, `QUIT` — and no message is ever sent.

The only thing returned to the browser is one of these classifications, a fixed
explanation, the latency and a correlation reference:

| Result | Meaning |
|---|---|
| `Connected successfully` | The provider accepted the credentials and returned the documented response. |
| `Authentication failed` | The provider rejected the stored credentials. |
| `Permission denied` | The credentials are valid but lack the scope this integration needs. |
| `Invalid endpoint` | The configured endpoint does not expose the expected provider API. |
| `Timeout` | The provider did not answer within the configured timeout. |
| `Provider unavailable` | The provider is throttling, erroring or returned an unreadable payload. |
| `Invalid configuration` | The stored configuration is incomplete, or the provider rejected the request as malformed. |
| `Disabled` | The integration exists but is switched off. |
| `Not configured` | No configuration exists for this provider in this environment. |
| `NOT VERIFIED` | Never tested, or reset after a credential rotation. |

Raw provider responses, response headers, credentials and stack traces are never
shown, stored or logged. A `200 OK` that carries `{"ok": false}` is reported as a
failure, not as a success.

The dashboard shows only real state. A newly created integration is
**NOT VERIFIED** until an actual test succeeds, and rotating a credential resets
it to **NOT VERIFIED** again.

`crons/cloudhost247_integrations.php` re-verifies every enabled integration for
an environment on a schedule and records the real outcome:

```
0 */6 * * * php /path/to/whmcs/crons/cloudhost247_integrations.php production
```

---

## 7. Rotation

Two supported paths, both audited:

1. **Credential rotation** — on the configuration screen use *Credential
   rotation* to replace exactly one credential. Configuration is untouched, the
   status resets to **NOT VERIFIED**, and the audit log records which field was
   replaced (never its value).
2. **Edit** — leaving a credential field blank on the main form keeps the stored
   value. A credential changes only when a replacement is explicitly typed in.
   The confirmation message lists exactly which credentials were replaced.

Recommended sequence for a zero-downtime rotation: create the new credential at
the provider, paste it into the rotation field, run the connection test, confirm
`Connected successfully`, then revoke the old credential at the provider.

**Deployment key rotation.** Change `CH247_INTEGRATIONS_KEY`, restart PHP, then
re-enter every credential. Values encrypted with the previous key are listed in
the UI with a red *"Encrypted with a previous master key"* warning, so nothing is
silently broken and nothing is silently re-encrypted.

---

## 8. Failure handling

Integrations fail loudly and safely. There is no fake success and no silent
continue.

- `IntegrationManager::client()` throws `IntegrationException` when a provider is
  missing, disabled, undecryptable or misconfigured. The exception carries a
  result code and a correlation id, never a credential.
- Each such failure writes a sanitized `runtime_failure` event
  (provider, environment, result code, short detail, correlation id) to the
  integration event log and a structured line to the CloudHost247 log.
- Modules that keep their own hardened client (RDP, OVH) surface the same
  controlled error instead of falling back to an unconfigured default endpoint.
- The LTE Proxy client now refuses to build at all without a configured HTTPS
  endpoint and API key; it no longer assumes a default production host.
- Administrators troubleshoot with the **Connection events** tab, filtering by
  provider, environment, event type or result, and correlate the reference id
  with the CloudHost247 audit log.

---

## 9. Supported integrations

Every entry below is backed by a real provider definition, real credential
storage and a real connection test. Nothing here is a placeholder.

Each entry states the same things, in the same order:

- **Required credentials** and configuration — the field table at the end of the
  entry. Fields marked *required* must be present before the integration can be
  enabled; fields stored in the **encrypted vault** are the credentials.
- **Where to obtain** them — the exact screen in the provider's console.
- **Required scopes / permissions** — the minimum the credential needs. Grant
  no more than this.
- **Endpoint requirements** — whether the URL is fixed, derived from the region
  or environment, or supplied by the administrator, plus any host or port
  restriction.
- **Connection testing** — the read-only call the *Test* button makes.
- **Test vs production** — any rule that prevents a sandbox credential being
  used in production, or the reverse.

Rotation, failure handling and the security model are identical for every
provider and are described in sections 4, 7 and 8.

### RDP / Remote desktop

#### Remote Desktop provider — `rdp`

Provider API behind the CloudHost247 secure RDP server module.

- **Vendor:** Authorized RDP provider
- **Provider documentation:** docs/independent-rebuild/RDP-SECURE-REBUILD-WORK-ITEM.md
- **Where to obtain credentials:** Issued by the authorized RDP provider control panel.
- **Required scopes / permissions:** `GET /me`, `GET /services/{id}`, `POST /services`, `POST /services/{id}/{action}`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Connection test:** `GET /me` — response must be JSON
- **Platform usage:** modules/servers/RDP
- **Notes:** The RDP server module additionally requires the endpoint host in CH247_RDP_ALLOWED_HOSTS.

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API base URL (`base_url`) | url | yes | configuration row | HTTPS origin documented by the provider, for example https://api.provider.example. The host must also appear in CH247_RDP_ALLOWED_HOSTS. |
| API access token (`access_token`) | secret | yes | **encrypted vault** | Bearer token issued by the provider. Sent in the Authorization header only. |

### Hosting & server provisioning

#### OVHcloud API — `ovh`

Signed OVHcloud API used for catalog, ordering, provisioning and reconciliation.

- **Vendor:** OVHcloud SAS
- **Provider documentation:** https://api.ovh.com/
- **Where to obtain credentials:** https://api.ovh.com/createToken/
- **Required scopes / permissions:** `GET /auth/currentCredential`, `GET /me`, `GET /order/*`, `GET /dedicated/server/*`, `GET /vps/*`
- **Authentication:** OVH request signature (`X-Ovh-*` headers, SHA-1 of the application secret)
- **Endpoint:** Derived from the selected region — `eu` → `https://eu.api.ovh.com/1.0`, `ca` → `https://ca.api.ovh.com/1.0`, `us` → `https://api.us.ovhcloud.com/1.0`
- **Connection test:** `GET /auth/currentCredential` — response must be JSON; must contain `status`
- **Platform usage:** modules/addons/cloudhost247_ovh, modules/servers/cloudhost247_ovh, crons/cloudhost247_ovh.php

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API region (`region`) | select (`eu`, `ca`, `us`) | yes | configuration row |  |
| Application key (`application_key`) | secret | yes | **encrypted vault** | Created at the provider token page together with the secret and consumer key. |
| Application secret (`application_secret`) | secret | yes | **encrypted vault** |  |
| Consumer key (`consumer_key`) | secret | yes | **encrypted vault** | Scope this key to the minimum access rules the platform needs. |

#### SoYouStart API — `soyoustart`

SoYouStart brand of the OVHcloud API used by the legacy dedicated-server automation.

- **Vendor:** OVHcloud SAS (SoYouStart brand)
- **Provider documentation:** https://eu.api.soyoustart.com/
- **Where to obtain credentials:** https://eu.api.soyoustart.com/createToken/
- **Required scopes / permissions:** `GET /auth/currentCredential`, `GET /dedicated/server/*`, `GET /ip/*`
- **Authentication:** OVH request signature (`X-Ovh-*` headers, SHA-1 of the application secret)
- **Endpoint:** Derived from the selected region — `eu` → `https://eu.api.soyoustart.com/1.0`, `ca` → `https://ca.api.soyoustart.com/1.0`
- **Connection test:** `GET /auth/currentCredential` — response must be JSON; must contain `status`
- **Platform usage:** modules/addons/soyoustart, modules/servers/soyoustart, modules/servers/soyoustart_vps, crons/getServer.php, crons/getIpStatus.php, crons/priceSync.php
- **Notes:** The vendor SoYouStart modules remain byte-identical; this entry centralises the credential source used when they are replaced.

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API region (`region`) | select (`eu`, `ca`) | yes | configuration row |  |
| Application key (`application_key`) | secret | yes | **encrypted vault** | Created at the provider token page together with the secret and consumer key. |
| Application secret (`application_secret`) | secret | yes | **encrypted vault** |  |
| Consumer key (`consumer_key`) | secret | yes | **encrypted vault** | Scope this key to the minimum access rules the platform needs. |

### WHM / cPanel control panels

#### WHM (cPanel server) — `whm`

WHM API 1 over HTTPS with an API token for server-level hosting automation.

- **Vendor:** cPanel, L.L.C.
- **Provider documentation:** https://api.docs.cpanel.net/whm/introduction/
- **Where to obtain credentials:** WHM -> Development -> Manage API Tokens
- **Required scopes / permissions:** `version`, `listaccts`, `createacct`, `suspendacct`, `unsuspendacct`
- **Authentication:** Provider specific request header
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Endpoint policy:** ports 443, 2087
- **Connection test:** `GET /json-api/version?api.version=1` — response must be JSON; must contain `version`
- **Platform usage:** Available for WHMCS cPanel/WHM server configuration

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| WHM base URL (`base_url`) | url | yes | configuration row | For example https://server.example.com:2087 |
| WHM user (`username`) | text | yes | configuration row | root or the reseller account that owns the token. |
| API token (`api_key`) | secret | yes | **encrypted vault** | Sent as "Authorization: whm user:token". Never placed in a URL. |

#### cPanel (account UAPI) — `cpanel`

cPanel UAPI with an account-scoped API token.

- **Vendor:** cPanel, L.L.C.
- **Provider documentation:** https://api.docs.cpanel.net/cpanel/introduction/
- **Where to obtain credentials:** cPanel -> Security -> Manage API Tokens
- **Required scopes / permissions:** `Variables::get_user_information`, `Email::list_pops`
- **Authentication:** Provider specific request header
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Endpoint policy:** ports 443, 2083
- **Connection test:** `GET /execute/Variables/get_user_information` — response must be JSON
- **Platform usage:** Available for WHMCS cPanel server configuration

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| cPanel base URL (`base_url`) | url | yes | configuration row | For example https://server.example.com:2083 |
| cPanel account (`username`) | text | yes | configuration row |  |
| API token (`api_key`) | secret | yes | **encrypted vault** | Sent as "Authorization: cpanel user:token". |

### Domain registrars

#### Gandi registrar API — `gandi`

Gandi v5 REST API for domain registration, renewal and contact management.

- **Vendor:** Gandi SAS
- **Provider documentation:** https://api.gandi.net/docs/domains/
- **Where to obtain credentials:** Gandi account -> Security -> Personal Access Token
- **Required scopes / permissions:** `domain:read`, `domain:manage`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.gandi.net/v5`
- **Connection test:** `GET /domain/domains?per_page=1`
- **Platform usage:** Available for domain registrar automation

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Personal access token (`access_token`) | secret | yes | **encrypted vault** | Sent as an Authorization bearer header. |
| Organisation ID (`account_id`) | text | no | configuration row | Optional sharing-id used when the token can see several organisations. |

#### GoDaddy Domains API — `godaddy`

GoDaddy Domains v1 API for availability lookup, registration, DNS, contacts
and transfer. GoDaddy's aftermarket/brokerage purchase of a domain already
owned by a third party is a separate GoDaddy product that this API does not
expose, and CloudHost247 never assumes that access exists.

- **Vendor:** GoDaddy.com, LLC
- **Provider documentation:** https://developer.godaddy.com/doc/endpoint/domains
- **Where to obtain credentials:** GoDaddy Developer Portal -> API Keys. Production keys require an approved GoDaddy account in good standing; OTE (test) keys are self-serve.
- **Required scopes / permissions:** `GET /v1/domains/available`, `GET /v1/domains/{domain}`, `PATCH /v1/domains/{domain}/records`, `POST /v1/domains/{domain}/transferOut`
- **Authentication:** `Authorization: sso-key {key}:{secret}` request header
- **Endpoint:** Environment-mapped — production `https://api.godaddy.com`, staging/development (OTE) `https://api.ote-godaddy.com`
- **Connection test:** `GET /v1/domains/available?domain=cloudhost247-health-check.com&checkType=FAST`
- **Platform usage:** `modules/addons/cloudhost247_broker` (domain search state resolution; `domain_availability` capability only — never brokerage)

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| GoDaddy API key (`username`) | text | yes | configuration row | Created at the GoDaddy Developer Portal. |
| GoDaddy API secret (`api_secret`) | secret | yes | **encrypted vault** | Sent only in the Authorization header, never in a URL. |

#### Sedo Marketplace Partner API — `sedo`

Sedo Marketplace Partner Program (MPP) API for domain search, for-sale lookup
and aftermarket brokerage requests. Requires an approved Sedo partner/API
agreement — CloudHost247 does not assume this access exists, and no
brokerage capability is exposed to a customer until the connection is both
configured and tested successfully.

- **Vendor:** Sedo GmbH
- **Provider documentation:** https://api.sedo.com/ (issued to approved Marketplace Partner Program members)
- **Where to obtain credentials:** Issued by the Sedo Marketplace Partner Program team after commercial approval.
- **Required scopes / permissions:** domain search, partner for-sale lookup, partner brokerage request
- **Authentication:** HTTP Basic (partner ID + sign key)
- **Endpoint:** Fixed provider URL — `https://api.sedo.com`
- **Connection test:** `GET /partner/status`
- **Platform usage:** `modules/addons/cloudhost247_broker` (Route A/B acquisition routing, once a partner agreement is confirmed)

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Sedo partner ID (`account_id`) | text | yes | configuration row | Basic-auth username. |
| Sedo sign key (`api_secret`) | secret | yes | **encrypted vault** | Used to authenticate partner API requests server-side. Never sent in a query string. |

A commercial Sedo Marketplace Partner Program agreement is required before
this integration can be enabled. Until the connection tests as Connected, the
broker engine treats Sedo as unavailable and routes affected cases to the
manual CloudHost247 broker instead.

#### Afternic Aftermarket API — `afternic`

Afternic aftermarket listing / Fast Transfer API for domains listed through
the Afternic marketplace network. Requires an approved Afternic reseller or
API partner agreement. CloudHost247 never displays "Afternic Connected"
unless this integration is both configured and tested successfully.

- **Vendor:** Afternic (a GoDaddy company)
- **Provider documentation:** Provided directly by Afternic to approved API partners; there is no public self-serve specification.
- **Where to obtain credentials:** Issued by the Afternic partner integrations team upon approval.
- **Required scopes / permissions:** for-sale lookup, Fast Transfer acquisition request
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint, issued at partner onboarding)
- **Connection test:** `GET /status`
- **Platform usage:** `modules/addons/cloudhost247_broker` (Route A/B acquisition routing, once a partner agreement is confirmed)

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Afternic API key (`api_key`) | secret | yes | **encrypted vault** | Sent as an Authorization bearer header. |

#### DomainAgents Brokerage API — `domainagents`

DomainAgents domain acquisition/brokerage service: owner outreach,
negotiation, offer/counteroffer and transfer support. Requires an approved
DomainAgents partner/API agreement. CloudHost247 does not assume this access
exists.

- **Vendor:** DomainAgents, LLC
- **Provider documentation:** Provided directly by DomainAgents to approved API partners.
- **Where to obtain credentials:** Issued by DomainAgents upon partner approval.
- **Required scopes / permissions:** acquisition request, negotiation status, offer submission, transfer status
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint, issued at partner onboarding)
- **Connection test:** `GET /status`
- **Platform usage:** `modules/addons/cloudhost247_broker` (Route B acquisition routing, once a partner agreement is confirmed)

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API base URL (`base_url`) | url | yes | configuration row | Supplied by DomainAgents at partner onboarding. |
| API key (`api_key`) | secret | yes | **encrypted vault** | Sent as an Authorization bearer header. |

Brokerage capability for Sedo, Afternic and DomainAgents is reported to the
platform, and to the Domain Broker Service's routing engine, only after each
respective integration tests as Connected **and** an administrator has
confirmed the partner/commercial agreement in **Super Admin -> Domain
Brokerage -> Providers**. Until then, `modules/addons/cloudhost247_broker`
routes affected cases to the manual CloudHost247 broker (the guaranteed
fallback), which requires no external API access at all.

### DNS

#### PowerDNS authoritative API — `powerdns`

PowerDNS authoritative HTTP API for zone and record automation.

- **Vendor:** PowerDNS / Open-Xchange
- **Provider documentation:** https://doc.powerdns.com/authoritative/http-api/index.html
- **Where to obtain credentials:** PowerDNS server configuration: api-key= in pdns.conf
- **Required scopes / permissions:** `GET /api/v1/servers`, `GET /api/v1/servers/localhost/zones`
- **Authentication:** Provider specific request header
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Connection test:** `GET /api/v1/servers` — response must be JSON
- **Platform usage:** Available for DNS automation of hosted zones

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API base URL (`base_url`) | url | yes | configuration row | For example https://ns1.example.com:8081 |
| API key (`api_key`) | secret | yes | **encrypted vault** | Sent in the X-API-Key header. |

### Cloudflare / edge

#### Cloudflare API — `cloudflare`

Cloudflare v4 API for DNS records, cache purge and zone settings.

- **Vendor:** Cloudflare, Inc.
- **Provider documentation:** https://developers.cloudflare.com/api/
- **Where to obtain credentials:** Cloudflare dashboard -> My Profile -> API Tokens -> Create Token
- **Required scopes / permissions:** `Zone:Read`, `DNS:Edit`, `Cache Purge`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.cloudflare.com/client/v4`
- **Connection test:** `GET /user/tokens/verify` — response must be JSON; must report `success` = `true`
- **Platform usage:** Available for zone, DNS and edge automation

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API token (`api_key`) | secret | yes | **encrypted vault** | Use a scoped API token, not the legacy global API key. |
| Account ID (`account_id`) | text | no | configuration row |  |

### Payments

#### Stripe — `stripe`

Stripe REST API for card payments and refunds.

- **Vendor:** Stripe, Inc.
- **Provider documentation:** https://docs.stripe.com/api
- **Where to obtain credentials:** Stripe dashboard -> Developers -> API keys
- **Required scopes / permissions:** `balance:read`, `charges:write`, `refunds:write`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.stripe.com/v1`
- **Connection test:** `GET /balance` — response must be JSON; must contain `object`
- **Test vs production guard:** api key: `{'production_requires_prefix': 'sk_live_', 'non_production_requires_prefix': 'sk_test_'}`
- **Platform usage:** Available for WHMCS payment gateway configuration

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Secret key (`api_key`) | secret | yes | **encrypted vault** | sk_live_... in production, sk_test_... in development and staging. |
| Webhook signing secret (`webhook_secret`) | secret | no | **encrypted vault** | whsec_... used to verify inbound webhooks. |

#### PayPal REST — `paypal`

PayPal REST API with OAuth2 client-credentials, separate live and sandbox hosts.

- **Vendor:** PayPal Holdings, Inc.
- **Provider documentation:** https://developer.paypal.com/api/rest/
- **Where to obtain credentials:** PayPal Developer dashboard -> Apps & Credentials
- **Required scopes / permissions:** `openid`, `https://uri.paypal.com/services/payments/payment`
- **Authentication:** OAuth 2.0 client-credentials grant, exchanged server-side for a short-lived bearer token
- **Endpoint:** Derived from the environment of this configuration — `production` → `https://api-m.paypal.com`, `staging` → `https://api-m.sandbox.paypal.com`, `development` → `https://api-m.sandbox.paypal.com`
- **Connection test:** `GET /v1/identity/oauth2/userinfo?schema=paypalv1.1` — response must be JSON
- **Platform usage:** Available for WHMCS payment gateway configuration

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Client ID (`client_id`) | text | yes | configuration row (JSON options) |  |
| Client secret (`client_secret`) | secret | yes | **encrypted vault** |  |

#### Blockonomics — `blockonomics`

Bitcoin payment API used by the Blockonomics WHMCS gateway.

- **Vendor:** Blockonomics
- **Provider documentation:** https://www.blockonomics.co/views/api.html
- **Where to obtain credentials:** Blockonomics -> Wallet Watcher -> Settings -> Generate new API Key
- **Required scopes / permissions:** `GET /api/address`, `POST /api/new_address`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://www.blockonomics.co/api`
- **Connection test:** `GET /address`
- **Platform usage:** modules/gateways/blockonomics.php, modules/gateways/callback/blockonomics.php

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API key (`api_key`) | secret | yes | **encrypted vault** | Sent as an Authorization bearer header. |

### Email & SMTP

#### SMTP relay — `smtp`

Authenticated SMTP submission used for transactional mail.

- **Vendor:** Deployment mail relay
- **Provider documentation:** https://datatracker.ietf.org/doc/html/rfc4954
- **Where to obtain credentials:** Issued by the mail relay operator.
- **Required scopes / permissions:** `SMTP AUTH submission`
- **Authentication:** SMTP AUTH LOGIN over TLS
- **Endpoint:** Fixed provider URL, not administrator editable — `smtp://configured-host`
- **Connection test:** live SMTP submission handshake (greeting, EHLO, STARTTLS where configured, AUTH LOGIN, QUIT — no message is sent)
- **Platform usage:** WHMCS mail delivery, crons/emailSend.php
- **Notes:** The connection test performs a real SMTP handshake, STARTTLS upgrade and AUTH exchange, then QUIT. No message is sent.

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| SMTP host (`host`) | text | yes | configuration row (JSON options) | For example smtp.example.com |
| Port (`port`) | number | yes | configuration row (JSON options) | Default `587`. |
| Encryption (`encryption`) | select (`tls`, `ssl`) | yes | configuration row (JSON options) | Default `tls`. |
| SMTP username (`username`) | text | yes | configuration row |  |
| SMTP password (`password`) | secret | yes | **encrypted vault** | Required by the SMTP AUTH protocol; stored encrypted and used server-side only. |
| Default from address (`from_address`) | text | no | configuration row (JSON options) |  |

#### cPanel SMTP (marketing) — `cpanel_smtp`

Authenticated SMTP submission through a cPanel-hosted mailbox, the primary delivery provider for CloudHost247 Marketing campaigns.

- **Vendor:** cPanel mail server
- **Provider documentation:** https://datatracker.ietf.org/doc/html/rfc4954
- **Where to obtain credentials:** cPanel -> Email Accounts (mailbox + password issued by the hosting account).
- **Required scopes / permissions:** `SMTP AUTH submission`
- **Authentication:** SMTP AUTH LOGIN over TLS
- **Endpoint:** Fixed provider URL, not administrator editable — `smtp://configured-host`
- **Connection test:** live SMTP submission handshake (greeting, EHLO, STARTTLS where configured, AUTH LOGIN, QUIT — no message is sent)
- **Platform usage:** modules/addons/cloudhost247_marketing
- **Notes:** The connection test performs a real SMTP handshake, STARTTLS upgrade and AUTH exchange, then QUIT. No message is sent. Marketing campaigns are subject to the module's queue batching and configurable rate limits. This is a separate integration row from the shared transactional `smtp` relay so marketing identity, rotation and throttle tuning never disturb transactional mail — the vault, probe, tester, and admin screens are shared, not duplicated.

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| SMTP host (`host`) | text | yes | configuration row (JSON options) | For example mail.example.com — usually the cPanel server hostname. |
| Port (`port`) | number | yes | configuration row (JSON options) | Default `465`. 465 = implicit TLS (SSL); 587 = STARTTLS. |
| Encryption (`encryption`) | select (`ssl`, `tls`) | yes | configuration row (JSON options) | Default `ssl`. |
| Mailbox (username) (`username`) | text | yes | configuration row | The full mailbox address, for example marketing@example.com. |
| Mailbox password (`password`) | secret | yes | **encrypted vault** | Stored encrypted and only ever written to the authenticated SMTP socket, server-side. |
| Default from name (`from_name`) | text | no | configuration row (JSON options) |  |
| Default from address (`from_address`) | text | no | configuration row (JSON options) | Should be the mailbox itself or an address on its domain (no unrelated-domain spoofing). |
| Default reply-to address (`reply_to`) | text | no | configuration row (JSON options) |  |

#### SendGrid — `sendgrid`

SendGrid v3 API for transactional email.

- **Vendor:** Twilio SendGrid
- **Provider documentation:** https://www.twilio.com/docs/sendgrid/api-reference
- **Where to obtain credentials:** SendGrid -> Settings -> API Keys
- **Required scopes / permissions:** `mail.send`, `scopes.read`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.sendgrid.com/v3`
- **Connection test:** `GET /scopes` — response must be JSON; must contain `scopes`
- **Platform usage:** Available for transactional email delivery

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API key (`api_key`) | secret | yes | **encrypted vault** |  |

#### Microsoft Graph — `microsoft_graph`

Microsoft Graph with an application registration, used for Microsoft 365 mailbox provisioning.

- **Vendor:** Microsoft Corporation
- **Provider documentation:** https://learn.microsoft.com/graph/api/overview
- **Where to obtain credentials:** Entra admin center -> App registrations -> Certificates & secrets
- **Required scopes / permissions:** `Organization.Read.All`, `User.ReadWrite.All`, `Directory.Read.All`
- **Authentication:** OAuth 2.0 client-credentials grant, exchanged server-side for a short-lived bearer token
- **Endpoint:** Fixed provider URL, not administrator editable — `https://graph.microsoft.com/v1.0`
- **Connection test:** `GET /organization` — response must be JSON; must contain `value`
- **Platform usage:** modules/servers/cloudhost247_email

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Directory (tenant) ID (`tenant_id`) | text | yes | configuration row (JSON options) |  |
| Application (client) ID (`client_id`) | text | yes | configuration row (JSON options) |  |
| Client secret (`client_secret`) | secret | yes | **encrypted vault** |  |

### SMS

#### Twilio — `twilio`

Twilio REST API for SMS and phone number services.

- **Vendor:** Twilio Inc.
- **Provider documentation:** https://www.twilio.com/docs/usage/api
- **Where to obtain credentials:** Twilio Console -> Account -> API keys & tokens
- **Required scopes / permissions:** `Accounts:read`, `Messages:write`
- **Authentication:** HTTP Basic authentication header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.twilio.com`
- **Connection test:** `GET /2010-04-01/Accounts/{account_id}.json` — response must be JSON; must contain `sid`
- **Platform usage:** modules/addons/phoneservices

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Account SID (`account_id`) | text | yes | configuration row | Begins with AC. |
| Auth token (`password`) | secret | yes | **encrypted vault** | Used as the HTTP basic password; never sent in a URL. |

### WhatsApp

#### WhatsApp Cloud API — `whatsapp_cloud`

WhatsApp Business Cloud API on the Meta Graph endpoint.

- **Vendor:** Meta Platforms, Inc.
- **Provider documentation:** https://developers.facebook.com/docs/whatsapp/cloud-api
- **Where to obtain credentials:** Meta for Developers -> WhatsApp -> API Setup (system user access token)
- **Required scopes / permissions:** `whatsapp_business_messaging`, `whatsapp_business_management`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://graph.facebook.com`
- **Connection test:** `GET /{api_version}/{account_id}?fields=display_phone_number,verified_name` — response must be JSON; must contain `id`
- **Platform usage:** Available for customer notification delivery

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Phone number ID (`account_id`) | text | yes | configuration row |  |
| Graph API version (`api_version`) | text | yes | configuration row | Default `v21.0`. |
| System user access token (`access_token`) | secret | yes | **encrypted vault** |  |

### Telegram

#### Telegram Bot API — `telegram`

Telegram Bot API for administrator and customer notifications.

- **Vendor:** Telegram FZ-LLC
- **Provider documentation:** https://core.telegram.org/bots/api
- **Where to obtain credentials:** Telegram @BotFather -> /newbot or /token
- **Required scopes / permissions:** `getMe`, `sendMessage`
- **Authentication:** Provider-mandated token path segment (Telegram bot API)
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.telegram.org`
- **Connection test:** `GET /{path_token}/getMe` — response must be JSON; must report `ok` = `true`
- **Platform usage:** Available for administrator notification delivery
- **Notes:** Telegram mandates the bot token in the URL path. The request URL is never logged; Redactor::url() replaces the token segment.

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Bot token (`access_token`) | secret | yes | **encrypted vault** | The Telegram protocol requires the token inside the request path. It is used server-side only and is redacted from every log, audit entry and error message. |
| Default chat ID (`chat_id`) | text | no | configuration row (JSON options) |  |

### Notifications

#### Slack — `slack`

Slack Web API for operational alerting.

- **Vendor:** Slack Technologies, LLC
- **Provider documentation:** https://api.slack.com/web
- **Where to obtain credentials:** Slack -> Your Apps -> OAuth & Permissions -> Bot User OAuth Token
- **Required scopes / permissions:** `chat:write`, `auth:test`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://slack.com/api`
- **Connection test:** `POST /auth.test` — response must be JSON; must report `ok` = `true`
- **Platform usage:** Available for operational alerting

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Bot user OAuth token (`access_token`) | secret | yes | **encrypted vault** | Begins with xoxb-. |
| Default channel (`channel`) | text | no | configuration row (JSON options) |  |

### AI / LLM

#### OpenAI — `openai`

OpenAI REST API for assistant and content features.

- **Vendor:** OpenAI, L.L.C.
- **Provider documentation:** https://platform.openai.com/docs/api-reference
- **Where to obtain credentials:** OpenAI platform -> API keys
- **Required scopes / permissions:** `api.model.read`, `api.responses.write`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.openai.com/v1`
- **Connection test:** `GET /models` — response must be JSON; must contain `data`
- **Platform usage:** Available for assistive content generation

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API key (`api_key`) | secret | yes | **encrypted vault** |  |
| Organization ID (`organization`) | text | no | configuration row (JSON options) |  |

#### Anthropic — `anthropic`

Anthropic Messages API for assistant features.

- **Vendor:** Anthropic PBC
- **Provider documentation:** https://docs.anthropic.com/en/api
- **Where to obtain credentials:** Anthropic Console -> API keys
- **Required scopes / permissions:** `models:read`, `messages:write`
- **Authentication:** Provider specific request header
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.anthropic.com/v1`
- **Connection test:** `GET /models` — response must be JSON; must contain `data`
- **Platform usage:** Available for assistive content generation

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API key (`api_key`) | secret | yes | **encrypted vault** |  |
| Anthropic version header (`api_version`) | text | yes | configuration row | Default `2023-06-01`. |

### Exchange rates

#### Frankfurter exchange rates — `frankfurter`

Public exchange-rate API consumed by the CloudHost247 currency engine.

- **Vendor:** Frankfurter (ECB reference data)
- **Provider documentation:** https://www.frankfurter.app/docs/
- **Where to obtain credentials:** No credentials required.
- **Required scopes / permissions:** `public read`
- **Authentication:** No credential (public read-only endpoint)
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Connection test:** `GET /latest?from=USD&to=EUR` — response must be JSON; must contain `rates`
- **Platform usage:** modules/addons/cloudhost247_currency

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API base URL (`base_url`) | url | yes | configuration row | Change only when a self-hosted Frankfurter instance is used. Default `https://api.frankfurter.app`. |

#### European Central Bank reference rates — `ecb`

Daily euro foreign-exchange reference rates used as the currency fallback provider.

- **Vendor:** European Central Bank
- **Provider documentation:** https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- **Where to obtain credentials:** No credentials required.
- **Required scopes / permissions:** `public read`
- **Authentication:** No credential (public read-only endpoint)
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Connection test:** `GET /stats/eurofxref/eurofxref-daily.xml` — body must contain `eurofxref`
- **Platform usage:** modules/addons/cloudhost247_currency

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Base URL (`base_url`) | url | yes | configuration row | Default `https://www.ecb.europa.eu`. |

### Storage

#### S3-compatible object storage — `s3`

AWS Signature Version 4 object storage used for backups and downloads.

- **Vendor:** AWS S3 / OVHcloud Object Storage / any S3-compatible endpoint
- **Provider documentation:** https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html
- **Where to obtain credentials:** Provider console -> access keys (access key ID + secret access key)
- **Required scopes / permissions:** `s3:ListAllMyBuckets`, `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`
- **Authentication:** AWS Signature Version 4 request signing
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Connection test:** `GET /` — body must contain `ListAllMyBucketsResult`
- **Platform usage:** Available for backup and object storage
- **Notes:** When a bucket is configured the health check performs a list-type=2 request limited to one key.

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Endpoint URL (`base_url`) | url | yes | configuration row | For example https://s3.eu-west-3.amazonaws.com or https://s3.gra.io.cloud.ovh.net |
| Region (`region`) | text | yes | configuration row | Default `us-east-1`. |
| Bucket (`bucket`) | text | no | configuration row (JSON options) | When set, the connection test lists one object in this bucket instead of listing all buckets. |
| Access key ID (`api_key`) | secret | yes | **encrypted vault** |  |
| Secret access key (`api_secret`) | secret | yes | **encrypted vault** |  |

### Monitoring

#### UptimeRobot — `uptimerobot`

UptimeRobot v2 API for uptime monitors and maintenance windows.

- **Vendor:** UptimeRobot Service Provider Ltd.
- **Provider documentation:** https://uptimerobot.com/api/
- **Where to obtain credentials:** UptimeRobot -> My Settings -> API keys
- **Required scopes / permissions:** `getAccountDetails`, `getMonitors`
- **Authentication:** Credential submitted in the POST body (never a query string)
- **Endpoint:** Fixed provider URL, not administrator editable — `https://api.uptimerobot.com/v2`
- **Connection test:** `POST /getAccountDetails` — response must be JSON; must report `stat` = `"ok"`
- **Platform usage:** Available for platform availability monitoring

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API key (`api_key`) | secret | yes | **encrypted vault** | Sent in the request body, never in the URL. |

### Verification / KYC

#### Onfido identity verification — `onfido`

Onfido API for customer identity verification and anti-fraud checks.

- **Vendor:** Onfido Ltd.
- **Provider documentation:** https://documentation.onfido.com/api/latest/
- **Where to obtain credentials:** Onfido Dashboard -> Developers -> API tokens
- **Required scopes / permissions:** `applicants:read`, `checks:write`, `webhooks:read`
- **Authentication:** Provider specific request header
- **Endpoint:** Derived from the selected region — `eu` → `https://api.eu.onfido.com/v3.6`, `us` → `https://api.us.onfido.com/v3.6`, `ca` → `https://api.ca.onfido.com/v3.6`
- **Connection test:** `GET /webhooks` — response must be JSON
- **Test vs production guard:** api key: `{'production_forbids_substring': 'api_sandbox', 'non_production_forbids_substring': 'api_live'}`
- **Platform usage:** Available for customer verification workflows

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| Data region (`region`) | select (`eu`, `us`, `ca`) | yes | configuration row |  |
| API token (`api_key`) | secret | yes | **encrypted vault** | Sandbox tokens contain api_sandbox; live tokens contain api_live. |

### Network & proxy

#### CloudHost247 LTE Proxy API — `lteproxy`

Reseller API behind the CloudHost247 LTE proxy server module.

- **Vendor:** CloudHost247
- **Provider documentation:** modules/servers/cloudhost247_lteproxy/README.md
- **Where to obtain credentials:** Issued by the CloudHost247 LTE proxy platform operator.
- **Required scopes / permissions:** `GET /account/info`, `GET /orders`, `POST /orders`
- **Authentication:** `Authorization: Bearer <secret>` request header
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Connection test:** `GET /account/info` — response must be JSON
- **Platform usage:** modules/servers/cloudhost247_lteproxy

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API base URL (`base_url`) | url | yes | configuration row | Supplied by the platform operator. No endpoint is hard-coded in source. |
| API key (`api_key`) | secret | yes | **encrypted vault** |  |

### Social media / SMM

#### SMM panel API — `smm_panel`

Standard SMM panel v2 API used by the social-media reseller modules.

- **Vendor:** SMM panel operator
- **Provider documentation:** modules/addons/smmaddon/README.md
- **Where to obtain credentials:** SMM panel account -> API section.
- **Required scopes / permissions:** `balance`, `services`, `add`, `status`
- **Authentication:** Credential submitted in the POST body (never a query string)
- **Endpoint:** Supplied by the administrator (validated HTTPS endpoint)
- **Connection test:** `POST (base URL)` — response must be JSON; must contain `balance`
- **Platform usage:** modules/addons/smmaddon, modules/servers/smmprovisioning

| Field | Type | Required | Stored | Purpose |
|---|---|---|---|---|
| API URL (`base_url`) | url | yes | configuration row | The panel API endpoint, for example https://panel.example.com/api/v2 |
| API key (`api_key`) | secret | yes | **encrypted vault** | Submitted in the POST body as "key"; never in a query string. |

---

## 10. Migrating an existing module

Existing modules were moved onto the central system without breaking working
installations. Each keeps a documented legacy fallback so an upgrade never
interrupts service, and the fallback disappears as soon as the central
integration is configured.

| Module | Central provider | Resolution order |
|---|---|---|
| `modules/servers/RDP` | `rdp` | `lib/Api/ConfigResolver.php` prefers the vault, then the WHMCS server record. The `CH247_RDP_ALLOWED_HOSTS` allowlist still applies to both. |
| `modules/addons/cloudhost247_ovh` | `ovh` | An endpoint opts in with *Use central OVH credentials* (migration `1.6.0` adds the nullable `integration_key` column). Endpoints without it keep reading `tblservers`. |
| `modules/servers/cloudhost247_lteproxy` | `lteproxy` | `lib/Configuration.php` is now the single configuration builder. The deprecated product options are read only when no central integration exists. |
| `modules/addons/cloudhost247_currency` | `frankfurter`, `ecb` | `lib/Support/EndpointResolver.php` uses the configured endpoint, otherwise the documented public one. These APIs need no credential. |

Migration steps for an existing installation:

1. Set `CH247_INTEGRATIONS_KEY` and `CH247_PLATFORM_ENVIRONMENT`, then restart PHP.
2. Activate **CloudHost247 API & Integrations**.
3. Configure each provider for the `production` environment and run its
   connection test until it reports `Connected successfully`.
4. Switch the dependent module over (tick *Use central OVH credentials* on the
   OVH endpoint; nothing to do for RDP and the LTE proxy, which prefer the vault
   automatically).
5. Clear the legacy credential fields — the WHMCS server record for RDP, the LTE
   proxy product configuration options — so only one copy of each credential
   remains.

---

## 11. Operational checklist

- [ ] `CH247_INTEGRATIONS_KEY` set from a 32-byte random value and stored outside the repository.
- [ ] `CH247_PLATFORM_ENVIRONMENT` set explicitly on development and staging.
- [ ] Every integration in use reports `Connected successfully` in its environment.
- [ ] Unused integrations are left unconfigured rather than filled with dummy values.
- [ ] `crons/cloudhost247_integrations.php` scheduled.
- [ ] Capability policies assigned so only Super Admin roles can rotate, enable, disable and change production endpoints.
- [ ] Legacy credential copies cleared after migration.
