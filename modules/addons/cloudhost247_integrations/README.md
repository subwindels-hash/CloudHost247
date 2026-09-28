# CloudHost247 API & Integrations

Central configuration for **every** external API the CloudHost247 platform calls.
One Super Admin screen — **Admin → Addons → CloudHost247 API & Integrations** —
replaces the per-module credential fields, hard-coded endpoints and duplicated
configuration builders that existed before.

Full reference: [`docs/independent-rebuild/API-INTEGRATIONS.md`](../../../docs/independent-rebuild/API-INTEGRATIONS.md).
Repository credential audit: [`docs/independent-rebuild/API-INVENTORY-AUDIT.md`](../../../docs/independent-rebuild/API-INVENTORY-AUDIT.md).

## Before activating

| Variable | Required | Value |
|---|---|---|
| `CH247_INTEGRATIONS_KEY` | **yes** | 32+ random bytes (hex, base64 or a long passphrase). May instead be `$ch247_integrations_key` in `configuration.php`. Without it the vault fails closed. |
| `CH247_PLATFORM_ENVIRONMENT` | recommended | `development`, `staging` or `production`. Unset is treated as `production`. |
| `CH247_INTEGRATION_ALLOW_PRIVATE_HOSTS` | no | `1` only when an integration must reach an internal control panel. |

```
head -c 32 /dev/urandom | base64
```

Requires the CloudHost247 Foundation addon (`cloudhost247_core`) for the audit
log and capability policy. PHP 7.4–8.2 with OpenSSL (`aes-256-gcm`) and cURL.

## What it does

- **Registry** of 27 real providers (RDP, OVH/SoYouStart, WHM, cPanel, Gandi,
  PowerDNS, Cloudflare, Stripe, PayPal, Blockonomics, SMTP, SendGrid, Microsoft
  Graph, Twilio, WhatsApp Cloud, Telegram, Slack, OpenAI, Anthropic,
  Frankfurter, ECB, S3, UptimeRobot, Onfido, LTE Proxy, SMM panel). Each screen
  shows only the fields that provider actually needs.
- **Encrypted credential vault** — AES-256-GCM, random IV per write, AAD bound
  to the integration row, field key and master-key fingerprint. Nothing is ever
  rendered to HTML, a URL, a log or an API response; the UI shows a mask and a
  fingerprint prefix.
- **Environment separation** — one configuration per provider per
  `development` / `staging` / `production`; production changes need an explicit
  per-submission confirmation; `sk_live_` / `sk_test_` style rules are enforced
  at save time.
- **Server-side connection testing** returning one of ten fixed classifications
  — never a provider payload, header, credential or stack trace.
- **Real-state health dashboard** and a sanitized event history with correlation
  ids. Untested integrations read `NOT VERIFIED`.
- **Safe failure handling** — `IntegrationException` with a result code and a
  correlation id instead of a silent fallback or a fake success.

## Layout

```
cloudhost247_integrations.php   WHMCS addon entry point (config/activate/deactivate/output)
bootstrap.php                   PSR-4 style autoloader for CloudHost247\Integrations\
migrations/V100.php             cloudhost247_integrations:1.0.0 (additive, hasTable-guarded)
lib/Registry/                   ProviderCatalog, ProviderRegistry, ProviderDefinition, FieldDefinition
lib/Security/                   MasterKey, SecretVault, UrlGuard
lib/Api/                        Transport, CurlTransport, IntegrationClient, SmtpProbe, Signers/
lib/Services/                   IntegrationRepository, IntegrationManager, ConnectionTester, AdminController, AdminView
lib/Support/                    Environment, ResultCode, Redactor, IntegrationException
```

## Adding a provider

Add one `ProviderDefinition` to `lib/Registry/ProviderCatalog.php`, or call
`ProviderRegistry::register()` from another module's bootstrap. The dashboard,
configuration screen, connection test, event history and runtime client factory
pick it up with no further changes. Do not add a provider without a real
credential set and a real health check.

## Using an integration at runtime

```php
use CloudHost247\Integrations\Services\IntegrationManager;

// Throws IntegrationException (result code + correlation id) when the
// integration is missing, disabled, undecryptable or misconfigured.
$client   = IntegrationManager::client('cloudflare');
$response = $client->request('GET', '/zones');

// Optional dependency: null when nothing is configured centrally.
$credentials = IntegrationManager::optionalCredentials('rdp');
```

## Tests

```
php tests/integrations/run.php                      # 99 behavioural assertions, no database required
python3 -m unittest tests.integrations.test_static  # 29 static-policy assertions
```

Both run on PHP 7.4 and 8.2 as part of `scripts/release-candidate-check.sh`.

## Deactivation

Deactivating retains all data — no table is dropped and no credential is
deleted. Dependent modules fall back to their documented legacy credential
sources.
