# CloudHost247 Cart Recovery

Native WHMCS addon that captures abandoned shopping carts, emails reminders
through the existing WHMCS mail system, restores carts from a secure link and
reports recovery/conversion analytics.

WHMCS stays the source of truth for the shopping cart, orders and invoices.
This addon only stores a sanitised snapshot next to it, and it never writes to
WHMCS core tables. The Node cart layer (`cloudhost247-node/src/db/carts.ts`)
serves the Node platform's own cart and is intentionally untouched: mixing the
two would create a second cart architecture.

## Contents

- [Installation](#installation)
- [Activation and database migration](#activation-and-database-migration)
- [Configuration](#configuration)
- [Cron setup](#cron-setup)
- [WHMCS email templates](#whmcs-email-templates)
- [Recovery flow](#recovery-flow)
- [Guest recovery behaviour](#guest-recovery-behaviour)
- [Lifecycle and statuses](#lifecycle-and-statuses)
- [Analytics definitions](#analytics-definitions)
- [Security model](#security-model)
- [Logging](#logging)
- [Troubleshooting](#troubleshooting)
- [Uninstall and disable behaviour](#uninstall-and-disable-behaviour)
- [Upgrade and migration process](#upgrade-and-migration-process)
- [Tests](#tests)

## Installation

Copy `modules/addons/cloudhost247_cart_recovery/` into the WHMCS installation
(it is already part of this repository, so a normal deployment of the repo is
enough). No Composer packages, no external services and no additional SMTP
configuration are required.

Requirements: the WHMCS version this store already runs (the addon uses only
`WHMCS\Database\Capsule`, the documented hooks and the Local API, and probes
for optional columns rather than assuming a schema), and PHP 7.4 or newer —
the same floor as the rest of the CloudHost247 PHP tree.

## Activation and database migration

Activate **CloudHost247 Cart Recovery** under *Setup → Addon Modules* and grant
access to the admin roles that should see it. Activation:

1. runs the versioned migrations (`migrations/V100.php`, `V101.php`),
2. seeds default settings,
3. creates the three reminder email templates if they do not already exist.

Migrations are guarded (`hasTable` / `hasColumn`), idempotent and recorded in
`mod_cloudhost247_cart_recovery_migrations`, so activating, upgrading or
re-running them is safe. The cron worker and the dashboard button *Verify /
Apply Database Migrations* run the same guarded path.

Tables created (all prefixed `mod_cloudhost247_cart_recovery_`):

| Table | Purpose |
| --- | --- |
| `..._recoveries` | one row per cart lifecycle: snapshot, status, token hashes, schedule, conversion |
| `..._reminder_logs` | one row per `(recovery_id, reminder_number)` — the idempotency key |
| `..._suppressions` | unsubscribe / suppression list by email and/or client id |
| `..._settings` | key/value settings plus the cron lock lease |
| `..._migrations` | applied schema versions |

## Configuration

All settings live on the addon dashboard (*Addons → CloudHost247 Cart
Recovery*). Durations are entered in seconds and validated/clamped on save.

| Setting | Default | Meaning |
| --- | --- | --- |
| Enable Cart Recovery | on | master switch for capture, reminders and recovery links |
| Enable Reminder 1 / 2 / 3 | on | each reminder can be disabled individually; disabled steps are skipped, not delayed |
| Abandonment Threshold | 3600 (1 hour) | inactivity before an active cart becomes `abandoned` |
| Reminder 1 Delay | 3600 (1 hour) | measured **from the abandonment timestamp** |
| Reminder 2 Delay | 86400 (24 hours) | from abandonment |
| Reminder 3 Delay | 259200 (72 hours) | from abandonment |
| Maximum Reminders | 3 | hard cap on the sequence |
| Recovery Token Lifetime | 604800 (7 days) | link validity |
| Enable Guest Cart Recovery | on | track guest carts once checkout supplies an email |
| Enable Unsubscribe | on | serve the unsubscribe endpoint |
| Cron Batch Size | 50 | records processed per worker run |
| Retry Delay | 3600 | wait before retrying a failed delivery |
| Maximum Retries | 3 | attempts per reminder before it is abandoned and the schedule advances |
| Cron Lock Lease | 300 | seconds a worker may hold the lock before it is considered crashed |

## Cron setup

The worker is CLI-only. Add one entry to the crontab of the account that owns
the WHMCS files, using that server's PHP binary and the real WHMCS path. On
the CloudHost247 cPanel deployment the WHMCS root is the directory that
contains `init.php`; determine it with
`php -r 'echo realpath("modules/addons/cloudhost247_cart_recovery/../../..");'`
from the WHMCS root and substitute the result below:

```cron
*/5 * * * * /usr/local/bin/php /home/cloudhos/public_html/whmcs/modules/addons/cloudhost247_cart_recovery/cron.php >> /home/cloudhos/logs/cart-recovery.log 2>&1
```

Replace `/usr/local/bin/php` and `/home/cloudhos/public_html/whmcs` with the
binary and path of the deployment; never copy a literal placeholder path into
production. Every five minutes is a good match for the one-hour granularity of
the default schedule.

Each run: applies pending migrations, takes the database lock, promotes
inactive carts to `abandoned`, sends only due and eligible reminders in
batches, records results, advances the schedule, expires stale records and
releases the lock. Overlapping runs exit immediately; a crashed run releases
its lease automatically.

## WHMCS email templates

Three *General* templates are created on activation and are then yours to edit
under *Setup → Email Templates*:

- `CloudHost247 Abandoned Cart Reminder 1`
- `CloudHost247 Abandoned Cart Reminder 2`
- `CloudHost247 Abandoned Cart Reminder 3`

They are never overwritten by the addon after creation. Merge variables:

| Variable | Contents |
| --- | --- |
| `{$customer_name}` / `{$customer_first_name}` | recipient name, or a neutral fallback |
| `{$customer_email}` | recipient address |
| `{$cart_items}` | escaped HTML table of the saved cart |
| `{$cart_items_text}` | same list as plain text |
| `{$cart_total}` / `{$cart_currency}` | total captured when the cart was saved |
| `{$recovery_url}` | secure, single-cart recovery link |
| `{$recovery_expires}` | link expiry timestamp |
| `{$unsubscribe_url}` | unsubscribe link (a different token from the recovery link) |
| `{$company_name}` / `{$company_domain}` | from WHMCS general settings |

The shipped copy is deliberately factual: it states that nothing has been
ordered, that items are **not** reserved and that prices are confirmed at
checkout. Keep that accurate if you rewrite the templates — the addon does not
reserve stock and does not guarantee pricing.

Delivery uses the WHMCS Local API `SendEmail` for customers with a client
record, and WHMCS's own `WHMCS\Mail\Message` service for guest addresses that
have no client record. No SMTP client, queue or credential store is added by
this addon; the marketing addon's cPanel SMTP queue is deliberately not reused
for transactional cart mail.

## Recovery flow

```
WHMCS cart page (ClientAreaPageCart)
  → snapshot captured / refreshed        (cheap: no DB write when nothing changed)
  → inactivity beyond the threshold      → status abandoned, reminder 1 scheduled
  → cron sends reminder 1 / 2 / 3        → each logged exactly once
  → customer clicks "Recover My Cart"
      → token validated and hashed → record located → expiry and state checked
      → sanitised cart written into $_SESSION['cart']
      → status recovered, activity refreshed, reminders cancelled
      → redirect to /cart.php?a=view
  → checkout (AfterShoppingCartCheckout, OrderPaid)
      → status converted, order id and authoritative revenue stored
```

Endpoints:

- `GET /modules/addons/cloudhost247_cart_recovery/recover.php?token=<token>`
- `GET /modules/addons/cloudhost247_cart_recovery/recover.php?action=unsubscribe&token=<token>`

If the store publishes prettier URLs (for example `/cart/recover/<token>`),
point a rewrite rule at the first endpoint; the addon itself does not modify
the web-server configuration.

## Guest recovery behaviour

- A guest cart is only recorded once `ShoppingCartValidateCheckout` supplies an
  email address, and only when *Enable Guest Cart Recovery* is on.
- Guest records are keyed by a hash of the session id, never by email alone.
- A supplied email address is never linked to an existing WHMCS account.
- A guest recovery link restores the cart and nothing else: it does not sign
  anyone in, does not expose account data and cannot read another customer's
  record.
- If a signed-in customer continues a cart started as a guest in the *same
  browser session*, that one record is adopted; a session record already owned
  by a different client id is never matched.

## Lifecycle and statuses

```
active ──inactivity──▶ abandoned ──reminders 1..3──▶ (token expiry) ──▶ expired
   │                        │
   │                        └──recovery link──▶ recovered ──checkout──▶ converted
   ├──cart emptied / admin cancel──▶ closed
   └──unsubscribe / suppression──▶ unsubscribed
```

`converted`, `expired`, `closed` and `unsubscribed` are terminal: they never
receive another reminder and their recovery links stop working. Meaningful
cart activity (add/remove product, quantity, billing cycle, domain, addon or
configurable-option change) resets `last_activity_at`, returns the record to
`active` and clears the reminder schedule. Emptying the cart closes the
record; a later cart starts a new lifecycle.

## Analytics definitions

The dashboard shows only live counts from this installation — no seeded,
sampled or synthetic figures. An empty installation shows zeroes.

- **Eligible carts** = `abandoned + recovered + converted + expired + unsubscribed`
  (carts that actually reached the recovery stage; `active` and `closed` are excluded).
- **Recovery rate** = `(recovered + converted) ÷ eligible × 100`.
  *Recovery* means the customer came back through a recovery link.
- **Conversion rate** = `converted ÷ eligible × 100`.
  *Conversion* means WHMCS created an order for that cart — a strictly
  stronger event than recovery, and separate again from payment.
- **Recovered revenue** = sum of `recovered_revenue`, which is copied from the
  authoritative WHMCS invoice total (falling back to the order amount). The
  browser-side `cart_total` is only ever used for display, never as revenue.
- **Reminders sent / failed** are counts of reminder-log rows, i.e. messages
  accepted by the WHMCS mail system — not a delivery guarantee.

## Security model

- Recovery tokens are 256-bit `random_bytes` values; only SHA-256 hashes are
  stored for lookup. The raw token exists in the email URL and, so later
  reminders can rebuild the same link, in a WHMCS-`encrypt()`-sealed column.
  It is never logged, never shown in the admin UI and never exported.
- The unsubscribe link carries a *different*, derived token, so forwarding an
  unsubscribe link cannot expose the cart.
- Tokens expire (default 7 days). Expired, converted, closed and unsubscribed
  records fail closed with a neutral, branded page and no internal detail.
- A token restores only its own cart. Identity, authentication and all other
  session keys are untouched, and the restored structure is re-sanitised on
  the way out of the database.
- Snapshots are allow-listed and additionally filtered by a deny pattern:
  card numbers, CVV, passwords, API keys, gateway secrets and session tokens
  are never stored.
- Admin actions require the WHMCS `Manage Addon Modules` permission and a
  valid `WHMCS.admin.default` CSRF token; all queries are parameterised via
  Capsule and every admin output is escaped with `htmlspecialchars`.
- Manual admin actions run the same validation as cron, so an administrator
  cannot produce duplicate or out-of-policy emails.

## Logging

Logging reuses the Foundation logger
(`modules/addons/cloudhost247_core/lib/Support/Logger.php`), falling back to
`logModuleCall`. Events: `cart.captured`, `cart.abandoned`, `cart.closed`,
`cart.recovered`, `cart.converted`, `cart.expired`, `cart.token_expired`,
`cart.recovery_rejected`, `customer.unsubscribed`, `reminder.scheduled`,
`reminder.sent`, `reminder.failed`, `migration.applied`, `cron.started`,
`cron.completed`, `cron.failed`, and `hook.*_failed`.

Context is scrubbed before it is written: any key resembling a token,
password, card or API key is redacted, long credential-like strings inside
exception messages are stripped, and stored error text is truncated.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| No records appear | Is the addon active and *Enable Cart Recovery* on? Hooks only load for active addons. Visit `cart.php` with a non-empty cart. |
| Records stay `active` | The abandonment threshold has not elapsed, or cron is not running. Check the cron log. |
| Reminders never send | Run `php .../cron.php` by hand and read the JSON summary; check `..._reminder_logs.status` and `error_message`; confirm the three templates exist and are not disabled in WHMCS. |
| `locked` / "worker holds the lock" | A previous run is still going or crashed within the lease; wait out *Cron Lock Lease* seconds. |
| Recovery link says it is not valid | The token expired, the cart converted, or the cart was emptied — all by design. Check the record's status in the dashboard. |
| Guest emails not delivered | Guest delivery needs `WHMCS\Mail\Message`; verify WHMCS mail settings under *Setup → General Settings → Mail*. |
| Revenue shows blank | The record converted before an invoice existed; `OrderPaid` fills it in on payment. |

## Uninstall and disable behaviour

Deactivating the addon stops new tracking, reminder processing and recovery
links (WHMCS stops loading `hooks.php`, the cron worker exits early, and the
endpoints refuse to act). Historical recovery, reminder and suppression data
is **kept**: deactivation is non-destructive by design.

There is no silent data deletion anywhere in this addon. If you genuinely want
the history gone, drop the five `mod_cloudhost247_cart_recovery_*` tables
manually after taking a backup — that is an explicit, irreversible act, and no
WHMCS customer, order or invoice record is affected by it.

## Upgrade and migration process

Deploy the new files and either open the addon dashboard and press *Verify /
Apply Database Migrations*, or simply let the next cron run apply them —
`cloudhost247_cart_recovery_upgrade()` also runs the same path. Add new schema
changes as a new `migrations/V1xx.php` class registered in
`MigrationRunner::migrations()`; each migration must remain guarded and
idempotent. Applied versions are tracked, so nothing runs twice.

## Tests

```bash
php tests/cart_recovery/run.php                       # behaviour suite (no WHMCS, no network)
python3 -m unittest tests/cart_recovery/test_static.py # structural and security invariants
```

The behaviour suite covers capture (authenticated, guest, empty, updated,
duplicate), abandonment thresholds, the reminder sequence with disabled steps
and caps, duplicate-cron idempotency, delivery failure and bounded retries,
conversion from authoritative order data, recovery with valid/invalid/expired
and already-converted tokens, cross-customer isolation, unsubscribe,
analytics definitions, admin permissions/CSRF/manual actions and the
sanitisation guarantees.
