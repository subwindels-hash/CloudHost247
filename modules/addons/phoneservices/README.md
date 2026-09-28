# Phone Number Services Platform for WHMCS

An API-first, provider-agnostic telecom platform for WHMCS: virtual numbers, VoIP
(WebRTC + PSTN), SMS / WhatsApp / email messaging, eSIM data plans, and full usage,
billing and analytics — with a Super Admin panel that lets you swap providers,
re-price, and enable or disable entire services without touching code.

- **Version:** 1.1.0
- **Requires:** WHMCS 8.0+, PHP 7.4+ (tested on 7.4 and 8.2), MySQL 5.7+ / MariaDB 10.2+
- **Composer:** optional (the module ships a PSR-4 fallback autoloader and uses no vendor SDKs)

---

## Table of contents

1. [Feature overview](#1-feature-overview)
2. [Architecture](#2-architecture)
3. [Module structure](#3-module-structure)
4. [Installation](#4-installation)
5. [Cron jobs](#5-cron-jobs)
6. [Configuration](#6-configuration)
7. [Providers](#7-providers)
8. [Webhooks](#8-webhooks)
9. [Provisioning (server) modules](#9-provisioning-server-modules)
10. [REST API](#10-rest-api)
11. [Database schema](#11-database-schema)
12. [Security model](#12-security-model)
13. [Extending the platform](#13-extending-the-platform)
14. [Testing](#14-testing)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Feature overview

### A. Virtual numbers
Multi-country search and purchase, local / second / toll-free / mobile / national
number types, and a complete lifecycle: **activate → assign to a service → renew →
suspend → release back to the pool**. Renewals and expiry reminders are driven by
the daily cron.

### B. VoIP
Browser calling over WebRTC (Twilio Voice SDK loaded only when the active voice
provider advertises the `webrtc` capability), inbound and outbound PSTN, international
dialling, real-time status (`ringing` / `connected` / `ended` / `failed`) and call
detail records with duration, caller ID, receiver ID, cost and timestamps. Inbound
calls are bridged to the browser client that owns the number, or to the number's
`forward_to` handset.

### C. SMS & messaging
Global send/receive, OTP generation + verification (length, TTL and attempt limits
configurable), WhatsApp Business Cloud API, SendGrid transactional email, message
logs with normalised delivery state (`queued`, `sent`, `delivered`, `received`,
`failed`).

### D. eSIM & data
Plan catalogue from the active eSIM provider, purchase and activation, QR code /
LPA activation details (no hard dependency on a QR library — see
[QR codes](#qr-codes)), global and local plans, real-time data usage sync and
lifecycle activate / top-up / renew / expire.

### E. Usage, billing & monitoring
Every call, message and megabyte is metered into `mod_phoneservices_usage` and
priced into `mod_phoneservices_transactions`. Clients get a live analytics
dashboard; admins get usage reports, transaction monitoring and system-wide logs.

### Super Admin panel
API configuration, provider routing and health checks, per-country/per-service
pricing, dynamic service toggles, user & subscription management, transaction
monitoring and searchable logs.

---

## 2. Architecture

```
          ┌──────────────── WHMCS ─────────────────┐
          │  addon module │ hooks │ server modules │
          └───────┬───────────┬──────────┬─────────┘
                  │           │          │
            ┌─────▼─────┐ ┌───▼────┐ ┌───▼──────────┐
            │  Module   │ │  Cron  │ │ Provisioning │   (lib/Core)
            └─────┬─────┘ └───┬────┘ └───┬──────────┘
                  │           │          │
          ┌───────▼───────────▼──────────▼────────┐
          │            Service layer               │   (lib/Services)
          │  Number · Voip · Sms · Esim · Usage    │
          │              · Pricing · Cron          │
          └───────────────────┬────────────────────┘
                              │  TelecomProviderInterface (+ capability interfaces)
          ┌───────────────────▼────────────────────┐
          │           Integration layer            │   (lib/Providers)
          │ Twilio · Vonage · Airalo · Truphone     │
          │ WhatsApp · SendGrid                     │
          └───────────────────┬────────────────────┘
                              │ HttpClient (cURL, no vendor SDKs)
                        provider REST APIs
```

Three hard rules keep the platform modular:

1. **Nothing is hardcoded to a provider.** Services resolve a provider through
   `ProviderFactory::forCapability($capability)`, which honours the admin's routing
   choice (`provider_{capability}` setting), then `default_provider`, then the first
   registered provider advertising that capability.
2. **Templates never talk to providers.** Admin/client templates receive plain PHP
   variables from `Module`, which calls the service layer.
3. **The REST API is the only write path for the browser.** The client area
   JavaScript performs every mutation through `api/rest.php`, so the same behaviour
   is available to third-party integrations.

---

## 3. Module structure

```
modules/addons/phoneservices/
├── phoneservices.php                 # WHMCS addon entry points
├── bootstrap.php                     # PHONESERVICES_ROOT/VERSION + PSR-4 autoloader
├── hooks.php                         # cron, billing, suspend/terminate, asset injection
├── composer.json                     # optional dev tooling only
├── cron/run.php                      # CLI runner: `php run.php daily|frequent`
├── api/
│   ├── bootstrap.php                 # WHMCS init + request helpers for HTTP endpoints
│   ├── rest.php                      # REST entry point (CORS allowlist, auth, routing)
│   └── webhooks/{twilio,vonage,whatsapp,sendgrid}.php
├── install/
│   ├── schema.sql                    # full schema (fresh installs)
│   └── migrations/*.sql              # incremental DDL (tracked in a migrations table)
├── lib/
│   ├── Core/        Module, Installer, Config, Crypto, Security, Database,
│   │                Logger, HttpClient, Router, Provisioning
│   ├── Interfaces/  TelecomProviderInterface + Number/Voice/Sms/Esim interfaces
│   ├── Providers/   AbstractProvider, ProviderRegistry, ProviderFactory,
│   │                Twilio, Vonage, Airalo, Truphone, WhatsApp, Sendgrid
│   ├── Services/    Number, Voip, Sms, Esim, Usage, Pricing, Cron
│   └── API/         Controllers/ + Middleware/AuthMiddleware
├── templates/
│   ├── clientarea.tpl                # Smarty shell for the client area
│   ├── admin/*.tpl                   # PHP templates (dashboard, api_config, providers,
│   │                                   pricing, numbers, voip, sms, esim, usage,
│   │                                   transactions, users, logs)
│   └── client/*.tpl                  # PHP templates + _helpers.php
├── assets/{css,js}/...
└── lang/english.php

modules/servers/phoneservices_{numbers,voip,sms,esim}/   # provisioning modules
tests/phoneservices/run.php                              # behaviour diagnostics
```

---

## 4. Installation

### Step 1 — upload

Copy `modules/addons/phoneservices/` into your WHMCS installation. If you want the
per-service products, also copy the four `modules/servers/phoneservices_*`
directories.

### Step 2 — (optional) Composer

```bash
cd /path/to/whmcs/modules/addons/phoneservices
composer install --no-dev --optimize-autoloader
```

Composer is **not required**: `bootstrap.php` registers a PSR-4 autoloader when
`vendor/` is absent, and the module talks to every provider over plain REST with
cURL. A missing `composer install` can never fatal your WHMCS installation.

### Step 3 — activate

**System Settings → Addon Modules → Phone Number Services Platform → Activate.**

Activation runs `install/schema.sql`, then applies any pending files in
`install/migrations/` (recorded in `mod_phoneservices_migrations`), then seeds the
default settings. Upgrading the module re-runs only the pending migrations, so
activation and upgrade are both idempotent.

### Step 4 — permissions

Click **Configure** on the addon and grant access to the admin roles that should
see the platform. The addon's own settings are intentionally minimal — operating
mode, webhook base URL, and whether to show the client-area navbar link. **Provider
credentials are entered in the module's own API Configuration page**, where they are
encrypted at rest.

### Step 5 — cron

See the next section. Without the cron jobs, renewals, expiry reminders, usage sync
and stuck-call reconciliation will not run.

### Step 6 — products (optional)

Create WHMCS products using the `phoneservices_numbers`, `phoneservices_voip`,
`phoneservices_sms` or `phoneservices_esim` server modules to sell the services as
recurring products. See [section 9](#9-provisioning-server-modules).

---

## 5. Cron jobs

The module hooks into WHMCS's own cron (`DailyCronJob` and `AfterCronJob`), so on a
standard installation **no extra crontab entry is needed**. For installations that
prefer dedicated scheduling — or want the frequent job to run more often than the
WHMCS cron — use the CLI runner:

```cron
# Lifecycle: renewals, expiry reminders, eSIM usage sync, log/usage pruning, daily report
5 2 * * *    php /path/to/whmcs/modules/addons/phoneservices/cron/run.php daily

# Reconciliation: stuck calls and queued messages
*/10 * * * * php /path/to/whmcs/modules/addons/phoneservices/cron/run.php frequent
```

The runner is CLI-only (it refuses to execute over HTTP), exits non-zero on failure
and prints a summary of everything it touched.

---

## 6. Configuration

**Addons → Phone Number Services Platform → API Configuration.**

| Setting | Meaning |
|---|---|
| `api_mode` | `sandbox` exposes verbose API errors and marks traffic as test; `live` is production. |
| `default_provider` | Fallback provider when a capability has no explicit routing. |
| `provider_{capability}` | Explicit routing for `numbers`, `voice`, `sms`, `esim`, `whatsapp`, `email`, `webrtc`. |
| `enable_{numbers,voip,sms,esim,analytics}` | Dynamic service toggles. Disabled services vanish from the client area and are rejected by the API. |
| `webhook_base_url` | Defaults to `{SystemURL}/modules/addons/phoneservices/api/webhooks`. |
| `api_allowed_origins` | Comma-separated origins allowed to call the REST API cross-origin. Empty = same-origin only. |
| `api_rate_limit` | Requests per minute per API key (0 disables). |
| `currency`, `default_markup_percent` | Pricing defaults. |
| `otp_length`, `otp_ttl_seconds`, `otp_max_attempts` | OTP policy. |
| `usage_retention_days`, `log_retention_days` | Pruning windows for the daily cron. |
| `debug_logging` | Verbose (redacted) request/response logging. |

Pricing per country and per service type lives under **Pricing Control**; rates can
be set per minute, per unit, per month and per setup.

---

## 7. Providers

| Provider | numbers | voice | sms | webrtc | whatsapp | email | esim |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Twilio   | ✔ | ✔ | ✔ | ✔ |   |   |   |
| Vonage   | ✔ | ✔ | ✔ |   |   |   |   |
| WhatsApp (Meta Cloud API) |   |   |   |   | ✔ |   |   |
| SendGrid |   |   |   |   |   | ✔ |   |
| Airalo   |   |   |   |   |   |   | ✔ |
| Truphone |   |   |   |   |   |   | ✔ |

Every provider implements `TelecomProviderInterface` plus the capability interfaces
it supports, so switching provider is a dropdown change:

```php
use PhoneServices\Providers\ProviderFactory;

$sms   = ProviderFactory::forCapability('sms');            // admin-configured provider
$voice = ProviderFactory::forCapability('voice', 'vonage'); // explicit override
$twilio = ProviderFactory::getProvider('twilio');           // by id
```

Provider methods return a uniform array: `['success' => bool, 'error' => ?string, ...]`.
**Providers → Test connection** performs a live credential check per provider.

### QR codes

`EsimService::getQrCode()` prefers the provider's own QR image URL and the raw LPA
activation string, and always returns `manual_entry` (`smdp_address`,
`activation_code`) so a client can install a profile by hand. If `endroid/qr-code`
happens to be installed, a local PNG is added as `qr_base64` — but it is never
required.

---

## 8. Webhooks

All endpoints verify authenticity before touching any data and record the raw event
in `mod_phoneservices_provider_events`.

| Provider | URL | Verification |
|---|---|---|
| Twilio | `.../api/webhooks/twilio.php?event=sms\|voice\|sms-status\|call-status` | `X-Twilio-Signature` HMAC over the full URL + POST body |
| Vonage | `.../api/webhooks/vonage.php?event=sms\|voice\|sms-status\|call-status` | Signed-JWT `Authorization` header (enforced when `vonage_signature_secret` is set) |
| WhatsApp | `.../api/webhooks/whatsapp.php` | `hub.verify_token` handshake on GET, `X-Hub-Signature-256` on POST |
| SendGrid | `.../api/webhooks/sendgrid.php` | Shared secret in `Authorization` (when `sendgrid_webhook_secret` is set) |

Webhook endpoints boot WHMCS through `api/bootstrap.php`, so they participate in the
same configuration, logging and database layer as the rest of the module.

---

## 9. Provisioning (server) modules

Four thin modules let you sell each service as a WHMCS product. They delegate
everything to `PhoneServices\Core\Provisioning`, which records a row in
`mod_phoneservices_subscriptions` and mirrors WHMCS lifecycle events onto the
underlying resources:

| Module | Create | Suspend | Unsuspend | Terminate |
|---|---|---|---|---|
| `phoneservices_numbers` | optionally buys + assigns a number in the configured country | suspends the service's numbers | reactivates them | releases them |
| `phoneservices_voip` | activates the calling subscription | suspends it | reactivates it | cancels it |
| `phoneservices_sms` | activates messaging | suspends it | reactivates it | cancels it |
| `phoneservices_esim` | optionally provisions the configured plan | suspends the subscription | reactivates it | expires the profiles |

Config options are positional: **1** country/region, **2** type, **3** plan code,
**4** quota. Each module also contributes a client-area overview tab and an admin
Services-tab summary.

---

## 10. REST API

Base URL: `https://your-whmcs/modules/addons/phoneservices/api/rest.php`

### Authentication

- **Session** — client-area requests are authenticated by the WHMCS client session.
- **API key** — `Authorization: Bearer ps_live_...` (issue via `AuthMiddleware::issueApiKey()`).
- **JWT** — short-lived HS256 bearer tokens for machine-to-machine calls.

Each route declares a scope (`numbers`, `voip`, `sms`, `esim`, `usage`); API keys are
granted a subset. Only `GET /api/health` is unauthenticated.

### Envelope

```json
{ "success": true, "data": { "...": "..." } }
{ "success": false, "error": "Human readable message" }
```

`success: false` maps to HTTP 400 unless the controller returns an explicit
`status_code`.

### Endpoints

| Scope | Method & path |
|---|---|
| — | `GET /api/health` |
| numbers | `GET /api/numbers` · `GET /api/numbers/search` · `GET /api/numbers/countries` · `POST /api/numbers/purchase` · `POST /api/numbers/:id/{renew,suspend,release,assign}` |
| voip | `GET /api/voip/calls` · `GET /api/voip/token` · `POST /api/voip/call` · `POST /api/voip/call/:id/end` |
| sms | `GET /api/sms/messages` · `POST /api/sms/send` · `POST /api/sms/otp` · `POST /api/sms/otp/verify` · `POST /api/sms/whatsapp` · `POST /api/sms/email` |
| esim | `GET /api/esim/plans` · `GET /api/esim/profiles` · `GET /api/esim/:id/qrcode` · `GET /api/esim/:id/usage` · `POST /api/esim/purchase` · `POST /api/esim/:id/topup` |
| usage | `GET /api/usage` · `GET /api/usage/transactions` · `GET /api/usage/report` |

```bash
curl -H "Authorization: Bearer $TOKEN" \
     "https://your-whmcs/modules/addons/phoneservices/api/rest.php/api/numbers/search?country=GB&type=local"
```

---

## 11. Database schema

| Table | Contents |
|---|---|
| `mod_phoneservices_settings` | Configuration (secrets encrypted) |
| `mod_phoneservices_numbers` | Virtual numbers + lifecycle timestamps |
| `mod_phoneservices_calls` | Call detail records |
| `mod_phoneservices_messages` | SMS / WhatsApp / email logs |
| `mod_phoneservices_otp` | One-time codes (hashed, TTL + attempts) |
| `mod_phoneservices_esims` | eSIM profiles, data counters, QR data |
| `mod_phoneservices_usage` | Metered usage events |
| `mod_phoneservices_transactions` | Billable events, optional WHMCS invoice link |
| `mod_phoneservices_subscriptions` | Recurring number/eSIM/service subscriptions |
| `mod_phoneservices_pricing` | Rate card per service type and country |
| `mod_phoneservices_api_keys` | API keys with scopes and expiry |
| `mod_phoneservices_provider_events` | Raw provider webhook payloads |
| `mod_phoneservices_webrtc_tokens` | Issued WebRTC tokens |
| `mod_phoneservices_logs` | Structured application log |
| `mod_phoneservices_migrations` | Applied migration filenames |

New DDL must be added to **both** `install/schema.sql` (fresh installs) and a file in
`install/migrations/` (existing installs); the test suite asserts this.

---

## 12. Security model

- **Credentials at rest** — AES-256-GCM via `Crypto`, keyed with HKDF from the WHMCS
  `cc_encryption_hash`. Settings whose names end in `_key`, `_token`, `_secret`,
  `_sid`, `_password` or `_signature` are encrypted automatically and shown masked in
  the admin UI; resubmitting a mask is ignored.
- **No credentials in `tbladdonmodules`** — the addon config form deliberately holds
  no API keys.
- **CSRF** — every admin POST is protected with `Security::csrfToken()` / `verifyCsrf()`.
- **Ownership** — API controllers call `ownsOrFail()`, so a client can only read or
  mutate their own numbers, calls, messages and eSIMs.
- **CORS** — off by default; opt in per origin with `api_allowed_origins`.
- **Webhook authenticity** — HMAC / JWT verification on every endpoint (see §8).
- **Logging** — `Logger::redact()` strips secrets before anything is written, and log
  writes can never recurse or fatal a request.
- **Database** — Capsule/PDO with bound parameters only; the legacy WHMCS helpers
  (`select_query`, `full_query`, …) removed in WHMCS 8 are not used anywhere (asserted
  by the test suite).

---

## 13. Extending the platform

**Add a provider**

1. Create `lib/Providers/AcmeProvider.php` extending `AbstractProvider` and
   implementing the capability interfaces it supports.
2. Register it in `ProviderRegistry::builtIn()` with its label, capabilities and
   credential fields — the admin UI, routing dropdowns and health checks pick it up
   automatically.
3. Add `api/webhooks/acme.php` if the provider posts callbacks.

**Add an endpoint**

1. Add the action to the relevant controller in `lib/API/Controllers/`.
2. Register the route (with its scope) in `Router::registerDefaultRoutes()`.
3. Extend `tests/phoneservices/run.php` — it asserts every route maps to a real
   controller method.

---

## 14. Testing

```bash
php tests/phoneservices/run.php
```

The harness needs no database, no WHMCS runtime and no PHPUnit. It checks module
structure, template coverage, schema/migration parity, credential encryption
round-trips and tamper rejection, input validation, provider registry integrity,
absence of vendor SDKs and legacy DB helpers, status normalisation, and the complete
REST surface. CI (`.github/workflows/independent-foundation.yml`) runs it on PHP 7.4
and 8.2 alongside `php -l` over every module file and PHP template.

---

## 15. Troubleshooting

| Symptom | Where to look |
|---|---|
| "Provider unavailable" | **Providers** page → Test connection; credentials are set on **API Configuration**. |
| Browser calling never becomes ready | Site must be HTTPS; the voice provider must advertise `webrtc`; check the browser microphone permission and the console. |
| Webhooks rejected with 403 | The signature check failed: confirm the provider's signing secret and that `webhook_base_url` matches the URL the provider actually calls (proxies rewriting the host break HMACs). |
| Renewals/reminders never fire | Confirm the WHMCS cron runs, or add the `cron/run.php` entries from §5. |
| Client area page is blank | Check `mod_phoneservices_logs`; render errors are caught and logged rather than fataling WHMCS. |
| Activation fails | The MySQL user needs `CREATE TABLE`/`ALTER`; check `mod_phoneservices_migrations` for the last applied file. |

---

**Version 1.1.0** · WHMCS 8.0+ · PHP 7.4+
