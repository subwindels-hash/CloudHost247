# CloudHost247 Email Hosting — WHMCS provisioning module

A WHMCS **server (provisioning) module** — not an addon — that provisions business email
across three independent provider adapters behind one contract, plus the public
`email-hosting.php` landing page that sells it.

- **Version:** 1.0.0 · **Targets:** WHMCS 8.9.x, PHP 7.4+ (CI also runs PHP 8.2)
- **No Composer dependencies, no vendor SDKs, no WHMCS core changes.**

| Adapter | API | Authentication |
|---|---|---|
| Professional Business Email | Configurable provisioning REST API | Bearer / header key / basic |
| Microsoft 365 | Microsoft Graph v1.0 | OAuth 2.0 client credentials (application) |
| Google Workspace | Admin SDK Directory + Enterprise License Manager | Service account with domain-wide delegation (RS256 JWT) |

---

## Contents

1. [What it does](#1-what-it-does)
2. [Installation](#2-installation)
3. [Server settings (credentials)](#3-server-settings-credentials)
4. [Provider setup and required permissions](#4-provider-setup-and-required-permissions)
5. [Product configuration](#5-product-configuration)
6. [The public page](#6-the-public-page)
7. [Client area](#7-client-area)
8. [DNS handling](#8-dns-handling)
9. [Capability matrix](#9-capability-matrix)
10. [Automation, webhooks and logging](#10-automation-webhooks-and-logging)
11. [Idempotency and reconciliation](#11-idempotency-and-reconciliation)
12. [Security model](#12-security-model)
13. [Database schema](#13-database-schema)
14. [CLI](#14-cli)
15. [Testing](#15-testing)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. What it does

```
 order paid + approved
        │
        ▼
 WHMCS CreateAccount ──► Provisioner
        1 validate client / service / domain / mailbox
        2 validate provider configuration + permissions
        3 persistent per-service lock
        4 idempotency claim (replays short-circuit)
        5 licence / capacity check   (no free seat ⇒ refuse, create nothing)
        6 provider API create
        7 persist remote id + state, or flag for reconciliation
        8 audit event (redacted)
        9 WHMCS result
```

Suspend, unsuspend, terminate, change password and package change follow the same path.
`Renew` re-synchronises state. A timeout **after** a request was sent is recorded as
`needs_reconcile`, never retried blindly.

## 2. Installation

1. **Upload** the module to `modules/servers/hostx_email/` and the page files:
   - `email-hosting.php` (WHMCS root)
   - `templates/cloudhost247/cloudhost247-email-hosting.tpl`
   - `templates/cloudhost247/css/email-hosting.css`
2. **Create the schema.** It is created automatically on first use; to do it up front:
   ```bash
   php modules/servers/hostx_email/cron.php migrate
   ```
3. **Add a server** at *Configuration → System Settings → Servers*, type
   **CloudHost247 Email Hosting (WHMCS module ID: `hostx_email`)** — one server per provider tenant
   (see section 3). Use **Test connection**.
4. **Create products** whose module is `hostx_email` and assign them to that server group
   (section 5). The module never creates or re-prices WHMCS products itself.
5. **Link the page** from your navigation: `email-hosting.php`.
6. *(Optional)* add a cron entry for faster synchronisation:
   ```
   0,15,30,45 * * * * php /path/to/whmcs/modules/servers/hostx_email/cron.php sync >/dev/null 2>&1
   ```
   The WHMCS cron already runs a bounded pass via `hooks.php`, so this is optional.

Verify with:
```bash
php modules/servers/hostx_email/cron.php status
```

## 3. Server settings (credentials)

Credentials live **only** in the WHMCS server profile, which WHMCS encrypts at rest. The
module never copies them into its own tables, never writes them to a log and never renders
them in a template.

| Provider | Hostname | Username | Password | Access hash |
|---|---|---|---|---|
| `professional` | `https://` API base URL | (optional account id) | API key | JSON options (below) |
| `microsoft365` | — | Application (client) ID | Client secret | Tenant ID *or* JSON `{"tenant_id":"…"}` |
| `google` | — | Delegated admin address | — | Service-account JSON |

**Access-hash JSON options** (all optional, all providers):

```json
{
  "tenant_id": "contoso.onmicrosoft.com",
  "delegated_admin": "admin@example.com",
  "license_product_id": "Google-Apps",
  "service_account": { "client_email": "...", "private_key": "-----BEGIN PRIVATE KEY-----..." },
  "auth": "bearer | header | basic",
  "auth_header": "X-Api-Key",
  "paths": { "create": "/v2/mailboxes", "status": "/v2/mailboxes", "dns": "/v2/domains" },
  "webmail_url": "https://webmail.example.net",
  "webhook_secret": "…",
  "client_state": "…",
  "dns": {
    "*": [
      { "type": "MX", "host": "@", "value": "mx.example.net", "priority": 1, "ttl": 3600 }
    ]
  }
}
```

The `dns` block is how you display records for a provider whose API does not publish them
(Google Workspace). Values are rendered verbatim — put in exactly what the provider console
shows you.

## 4. Provider setup and required permissions

### Microsoft 365

Azure AD app registration with **application** permissions, admin consented:

| Permission | Why |
|---|---|
| `User.ReadWrite.All` | create / update / delete users, block sign-in, set passwords |
| `Organization.Read.All` | read `subscribedSkus` for licence availability |
| `Directory.Read.All` | read `assignedLicenses` |
| `Domain.Read.All` | read verification + service DNS records |

The product also needs a **usage location** (ISO country) — Microsoft refuses to assign a
licence without one. Directory-synchronised or federated tenants reject password writes; the
module reports that explicitly rather than pretending it worked.

### Google Workspace

The customer's Workspace **super administrator** must:

1. enable domain-wide delegation on the service account;
2. authorise the client id for exactly these scopes under
   *Security → API controls → Domain-wide delegation*:
   - `https://www.googleapis.com/auth/admin.directory.user`
   - `https://www.googleapis.com/auth/apps.licensing`
3. supply a delegated administrator address to impersonate.

Without step 2 or 3 Google returns `unauthorized_client`; the module surfaces that with the
exact remediation instead of failing silently. A service account **never** gains tenant
access on its own.

### Professional Email

Requires a genuine provisioning API (control panel or mail platform). **IMAP and SMTP cannot
create mailboxes** and the module will not pretend otherwise: with no API base URL and key it
returns a configuration error.

Expected contract (paths overridable):

```
POST   {base}/mailboxes                 -> {id,email,status,quota_mb}
GET    {base}/mailboxes/{id}            -> {id,email,status,usage_mb,quota_mb}
GET    {base}/mailboxes?email={email}   -> {data:[…]} | {id,…}
PATCH  {base}/mailboxes/{id}            -> suspend / unsuspend / password / plan
DELETE {base}/mailboxes/{id}
GET    {base}/domains/{domain}/dns      -> {records:[{type,host,value,priority,ttl}],verified}
GET    {base}/plans                     -> {plans:[{id,name,quota_mb}]}
```

## 5. Product configuration

*Products/Services → edit product → Module Settings.* The numbering is fixed
(`Support\Config::CONFIG_OPTIONS`); do not reorder.

| # | Option | Notes |
|---|---|---|
| 1 | Email provider | professional / microsoft365 / google |
| 2 | Plan tier | basic / standard / premium (drives the public page grouping) |
| 3 | Provider SKU / plan id | MS SKU GUID or part number, Google licence SKU, or platform plan id |
| 4 | Mailboxes included | informational |
| 5 | Storage per mailbox (GB) | blank ⇒ the page shows "not published" instead of a guess |
| 6 | Usage location | ISO country, required by Microsoft licensing |
| 7 | Webmail / login URL override | Professional Email only |
| 8 | Force password change at first sign-in | applied where supported |

Optional custom fields honoured if present: **Mailbox Username**, **Mailbox Address**,
**Contact Email**.

Pricing is ordinary WHMCS pricing. The module reads it; it never writes it.

## 6. The public page

`email-hosting.php` renders `cloudhost247-email-hosting.tpl` with:

- hero, provider cards, plan grid, comparison table, DNS section and FAQs;
- plans, prices, cycles, storage and availability read live from `tblproducts` /
  `tblpricing` for products whose `servertype` is `hostx_email`, in the visitor's currency;
- "Get Started" → `cart.php?a=add&pid=<real pid>`;
- a product with no price in the active currency renders **"Pricing not published"** —
  never a fabricated number; a hidden/retired product is marked **Not available**;
- copy is editable through `mod_hostx_email_content` (defaults in
  `lib/Repository/ContentRepository.php`):

```sql
UPDATE mod_hostx_email_content
   SET value_json = '{"heading":"…","subheading":"…","primary_cta":"…","secondary_cta":"…","disclaimer":"…"}'
 WHERE content_key = 'hero' AND locale = 'english';
```

No provider API is contacted while the page renders.

## 7. Client area

`templates/overview.tpl` replaces the service overview tab and shows: address, domain,
provider, plan, status, licence state, storage (only when the provider reports it), the
provider login button (Outlook / Gmail / Webmail), DNS state and records with per-record and
**Copy all** buttons, last synchronisation, plus a password-change form when the provider
supports it.

Actions are POST + CSRF token + ownership check. Rendering never calls a provider API;
"Refresh status" and "Refresh DNS" do, because the customer explicitly asked.

## 8. DNS handling

- **Microsoft 365** — records come from Graph
  (`/domains/{d}/verificationDnsRecords` and `/serviceConfigurationRecords`) and are mapped
  verbatim, including Microsoft's own MX preference values.
- **Professional Email** — from `GET {base}/domains/{d}/dns`, else from the configured `dns`
  JSON block.
- **Google Workspace** — no Admin SDK endpoint publishes them, so the module shows the
  administrator-configured records or says to use the Google Admin console.

Verification is reported as **verified** only when the provider says so, or when
`DnsService::verifyPublished()` resolves the live zone and matches the required values.
Otherwise the state is "awaiting propagation" / "not checked". **The module never writes to a
customer's DNS zone.**

## 9. Capability matrix

| Capability | Professional | Microsoft 365 | Google Workspace |
|---|---|---|---|
| Create mailbox / user | yes | yes | yes |
| Suspend / unsuspend | yes | yes (sign-in block) | yes |
| Terminate | yes | yes (licence released first) | yes (licence released first) |
| Change password | yes | yes (cloud-only tenants) | yes |
| Assign / remove licence | n/a | yes | yes |
| Status sync | yes | yes | yes |
| Storage usage | yes | **no** (needs Reports API) | **no** (not in Directory API) |
| DNS records | yes | yes | **no** (Admin console) |
| Plan/SKU discovery | yes | yes | **no** |
| Authenticated webhook | yes (HMAC) | yes (clientState) | **no** — refused |

The table on the public page is generated from these same flags.

## 10. Automation, webhooks and logging

- **Cron.** `hooks.php` runs a bounded pass on `DailyCronJob` (50 syncs / 20 reconciles) and
  a small catch-up on `AfterCronJob` (10 / 5). `cron.php sync` does the same from a system
  cron. A persistent lock prevents overlap.
- **Webhooks.** `webhook.php?provider=professional|microsoft365`.
  Professional Email: `HMAC-SHA256(timestamp + "." + body)` in `X-Hostx-Signature`, with
  `X-Hostx-Timestamp` (±5 min) and `X-Hostx-Event-Id`; verified event ids are stored so a
  replay is a no-op. Microsoft Graph: `validationToken` handshake plus `clientState`
  comparison. Google is **refused with 501** — no signed directory webhook is documented.
  A webhook only ever schedules a re-read; it never provisions, deletes or bills.
- **Logging.** `mod_hostx_email_log` (structured, correlation id) plus WHMCS `logModuleCall`,
  both passed through `Support\Redactor` — by key name, by value pattern (Bearer tokens, PEM
  keys, JWTs, `client_secret=` pairs) and via WHMCS replacement values.

## 11. Idempotency and reconciliation

Every mutation claims a deterministic key
(`operation-serviceId-sha256(inputs)`) in `mod_hostx_email_operations`, which has a UNIQUE
index on it. Consequences:

- a replayed WHMCS action returns the previous result instead of calling the provider again;
- a create whose account row already has a `remote_id` short-circuits immediately;
- a `409 Conflict` from the provider adopts the existing remote user rather than erroring;
- an uncertain outcome sets `needs_reconcile`, and the reconciler asks the provider what
  actually exists (`findByEmail`) before anything else happens;
- operations stuck `in_progress` for 30+ minutes are swept to `needs_reconcile`, not retried.

## 12. Security model

- WHMCS authentication, licensing and ionCube are untouched; no core file is modified.
- Server-side validation on every input; ownership checked on every client-area render and
  action; CSRF tokens on every POST; output escaped in both templates.
- HTTPS enforced by the transport (plain `http://` is refused), TLS peer + host verification
  always on, redirects not followed, bounded connect/total timeouts.
- Secrets never leave WHMCS-encrypted storage; no credential-shaped column exists in the
  module schema (asserted by the test suite).
- Customers see curated messages; provider diagnostics stay in the redacted log behind a
  correlation id.
- Fail-closed defaults: unknown provider → professional; unverifiable webhook → rejected;
  unknown duplicate state → skip rather than double-provision.

## 13. Database schema

`install/schema.sql` (idempotent) + `install/migrations/*.sql` tracked in
`mod_hostx_email_migrations`.

| Table | Purpose |
|---|---|
| `mod_hostx_email_accounts` | one row per service: remote id, status, licence, storage, DNS state (UNIQUE `service_id`) |
| `mod_hostx_email_operations` | idempotency + reconciliation ledger (UNIQUE `idempotency_key`) |
| `mod_hostx_email_locks` | persistent cooperative locks with expiry |
| `mod_hostx_email_log` | structured redacted log |
| `mod_hostx_email_webhooks` | receipts + replay protection (UNIQUE `provider,event_id`) |
| `mod_hostx_email_dns` | records shown to the customer, with source and verification state |
| `mod_hostx_email_content` | editable page copy |
| `mod_hostx_email_migrations` | applied migrations |

## 14. CLI

```bash
php cron.php migrate                      # create/upgrade the schema
php cron.php status                       # health summary
php cron.php sync --batch=25 --stale=360  # bounded status synchronisation
php cron.php reconcile --batch=10         # resolve uncertain operations
php cron.php service --service_id=1234    # one service
php cron.php prune --days=90              # log + webhook housekeeping
```

## 15. Testing

```bash
php tests/cloudhost247_email/run.php
```

**These are MOCK tests.** Provider calls are served by `lib/Testing/MockHttpClient.php`;
passing proves the module builds the right requests and interprets documented responses
correctly — it does not prove a live tenant behaves identically. Coverage: PHP 7.4/8.2 syntax
(CI), provider authentication (Graph client-credentials, Google delegated JWT claims),
product configuration, account creation + adoption/idempotency, licence availability and
assignment, suspension/reactivation, password policy and federated-tenant refusal,
termination ordering and idempotency, ownership enforcement, DNS mapping/classification/
clipboard, webhook signature + replay + unsupported-provider refusal, cron bounding, API
failure and reconciliation classification, and secret redaction.

Live-tenant verification is tracked in
`docs/independent-rebuild/STAGING-TEST-MATRIX.md` (section "CloudHost247 Email Hosting").

## 16. Troubleshooting

| Symptom | Check |
|---|---|
| "not configured" on every action | Server profile fields for that provider (section 3) and **Test connection**. |
| Microsoft `AADSTS7000215` | Wrong client secret, or the secret expired. |
| Microsoft "no free seats" | Add licences in the Microsoft 365 admin center; the module refuses to create an unlicensed orphan. |
| Google `unauthorized_client` | Domain-wide delegation not authorised for both scopes, or the delegated admin does not exist. |
| Password change refused (Microsoft) | Directory-synchronised/federated tenant — passwords are managed on-premises. |
| Service stuck "Being verified with the provider" | `php cron.php reconcile`; the log entry carries the correlation id. |
| No DNS records shown for Google | Expected — paste the Admin console values into the server `dns` JSON block. |
| Webhook returns 501 | That provider has no verifiable signature scheme; rely on the reconciler. |

---

**Version 1.0.0** · WHMCS 8.9.x · PHP 7.4+
