# Custom Affiliate Commission for WHMCS

Replaces the WHMCS default affiliate commission behaviour with a two-tier structure
that applies to **web hosting only**:

| Payment | Commission |
|---|---|
| First successful payment for a referred hosting service | **50 %** (configurable) |
| Every renewal of that same client + same service | **20 %** (configurable) |
| Domains, RDP, SSL, email hosting, add-ons, billable items, late fees | **0 %** — excluded entirely |

- **Version:** 2.0.0  ·  **Requires:** WHMCS 8.0+, PHP 7.4+ (tested on 7.4 and 8.2), MySQL 5.7+ / MariaDB 10.3+
- No Composer dependencies, no vendor SDKs, no core file edits.

---

## Table of contents

1. [How it works](#1-how-it-works)
2. [Why the default hook is not enough](#2-why-the-default-hook-is-not-enough)
3. [Installation](#3-installation)
4. [SQL schema](#4-sql-schema)
5. [Configuration](#5-configuration)
6. [Admin screens](#6-admin-screens)
7. [Edge cases](#7-edge-cases)
8. [Security &amp; performance](#8-security--performance)
9. [CLI utility](#9-cli-utility)
10. [File structure](#10-file-structure)
11. [Testing](#11-testing)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. How it works

```
 order with affiliate cookie
        │  (WHMCS writes tblaffiliatesaccounts: affiliateid ⇄ service)
        ▼
 invoice paid  ──►  InvoicePaid hook
                        │
                        ├─ for each invoice line item of type Hosting / Upgrade
                        │     ├─ resolve service → product → product group
                        │     ├─ group not commissionable?        → skip
                        │     ├─ service not referred?            → skip
                        │     ├─ payout row already exists?       → skip (duplicate guard)
                        │     ├─ ledger.first_commission_paid = 0 → FIRST  rate (50 %)
                        │     └─ ledger.first_commission_paid = 1 → RECUR. rate (20 %)
                        │
                        ├─ insert mod_customaffiliate_payouts   (unique per invoice item)
                        ├─ credit tblaffiliatespending  (delay > 0)
                        │      or tblaffiliates.balance + tblaffiliateshistory
                        └─ update mod_customaffiliate_commissions (the ledger)

 invoice refunded / cancelled / marked unpaid ──► reverse the above
```

Three deliberate design decisions:

1. **Commission is only ever created from a PAID invoice.** The hook re-reads the stored
   invoice status, so a gateway callback, an admin "Add Payment", the API and the cron all
   behave identically.
2. **The referring affiliate comes from `tblaffiliatesaccounts`** — the row WHMCS writes at
   order time from the affiliate tracking cookie/session — keyed by the service id. It is
   never guessed from the client record.
3. **Payouts are written into the real WHMCS affiliate tables**, so the standard cron
   clearing routine, the admin affiliate screens, withdrawal requests and the client-area
   affiliate page all keep working unchanged.

## 2. Why the default hook is not enough

WHMCS exposes two affiliate hooks, and **neither can change the commission amount**:

| Hook | Parameters | Response |
|---|---|---|
| `CalcAffiliateCommission` | `affid`, `relid`, `amount`, `commission` | *No response supported* |
| `AffiliateCommission` | `affiliateId`, `referralId`, `serviceId`, `commissionAmount`, … | Boolean `skipCommission` / `payout` only |

So returning a number from `AffiliateCommission` (a common mistake) silently does nothing —
WHMCS still pays its own percentage. The only correct strategy, and the one this module
implements, is:

```php
// hooks.php
add_hook('AffiliateCommission', 1, function ($vars) {
    return ['skipCommission' => true, 'payout' => false];   // stop the default payout
});

add_hook('InvoicePaid', 1, function ($vars) {               // …and pay the right amount ourselves
    (new CommissionEngine())->processInvoice((int) $vars['invoiceid']);
});
```

Suppressing the default is also what removes domains, RDP, SSL and everything else from
affiliate payouts: WHMCS pays nothing, and this module only ever pays for the configured
hosting group(s).

> `Settings → Suppress the WHMCS default commission` can be switched off if you
> deliberately want both systems to pay.

## 3. Installation

**Step 1 — upload**

```
/modules/addons/customaffiliate/
```

**Step 2 — activate**

*Configuration → System Settings → Addon Modules → Custom Affiliate Commission → Activate.*

Activation creates the tables, applies pending migrations, seeds the defaults and imports
any configuration from version 1.x. It is idempotent: activating, deactivating and
re-activating never loses data.

**Step 3 — grant access**

Click **Configure** on the addon and tick the admin roles that may see the module.
(The addon configuration screen intentionally holds no settings; everything is on the
module's own **Settings** tab, which supports a real product-group picker.)

**Step 4 — enable the WHMCS affiliate system**

*Configuration → System Settings → General Settings → Affiliates → Enable.*
Without it WHMCS never records referrals and there is nothing to pay commission on.
The module's dashboard warns you if this is off.

**Step 5 — configure**

*Addons → Custom Affiliate Commission → Settings*: tick your **Web Hosting** product group,
confirm 50 / 20, save.

**Step 6 — verify**

Place a test order through an affiliate link, pay the invoice, then check
**Commissions** (a `first` payout at 50 %) and the affiliate's own page in
*Clients → Manage Affiliates*.

No cron entry is required — the module reacts to `InvoicePaid`, which also fires for
renewal invoices paid through the WHMCS cron. The `DailyCronJob` hook only prunes the
audit log.

## 4. SQL schema

The canonical schema is [`install/schema.sql`](install/schema.sql) (applied automatically on
activation; safe to run by hand). Four tables plus a migration tracker:

| Table | Purpose |
|---|---|
| `mod_customaffiliate_commissions` | **The ledger.** One row per referred service: `service_id`, `affiliate_id`, `first_commission_paid`, counters and notes. |
| `mod_customaffiliate_payouts` | One row per commissioned invoice **line item**, with a `UNIQUE (invoice_id, invoice_item_id)` key — the duplicate-payout guard. |
| `mod_customaffiliate_settings` | Module configuration. |
| `mod_customaffiliate_log` | Audit trail of every decision, including skips. |
| `mod_customaffiliate_migrations` | Applied migration filenames. |

The minimum table the brief asks for is the ledger:

```sql
CREATE TABLE IF NOT EXISTS `mod_customaffiliate_commissions` (
    `id`                          INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
    `service_id`                  INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `affiliate_id`                INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `client_id`                   INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `product_id`                  INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `product_group_id`            INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `client_was_new`              TINYINT(1) NOT NULL DEFAULT 1,
    `first_commission_paid`       TINYINT(1) NOT NULL DEFAULT 0,
    `first_commission_amount`     DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `first_commission_invoice_id` INT(10) UNSIGNED NULL DEFAULT NULL,
    `first_commission_paid_at`    DATETIME NULL DEFAULT NULL,
    `total_recurring_commission`  DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `recurring_count`             INT(10) UNSIGNED NOT NULL DEFAULT 0,
    `total_commission`            DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    `notes`                       TEXT NULL,
    `created_at`                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `svc_aff_unique` (`service_id`, `affiliate_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Upgrading from 1.x adds the new columns automatically (`Installer::syncColumns()` checks
each column, so it works on MySQL as well as MariaDB).

## 5. Configuration

*Addons → Custom Affiliate Commission → Settings*

| Setting | Default | Meaning |
|---|---|---|
| First payment commission | `50` | Percentage of the first successful payment. |
| Recurring commission | `20` | Percentage of every renewal of the same service. |
| Minimum commissionable amount | `0.01` | Line items below this are ignored. |
| Clearing delay (days) | inherit | Blank = use the WHMCS *Affiliate Commission Delay*. |
| Product groups | *none* | Tick your **Web Hosting** group(s). Nothing else earns commission. |
| Enable this module | on | Off = stock WHMCS affiliate behaviour, untouched. |
| Suppress the WHMCS default commission | on | Required for the custom rates and exclusions to be authoritative. |
| First-payment rate for new clients only | on | An existing customer's new hosting service starts at the recurring rate. |
| Apply invoice discounts | on | Promotions/credits are spread across commissionable items before the rate. |
| Reverse commission on refund / cancel | on | Claw-back behaviour. |
| Debug logging | off | Log every evaluated line item, including skips. |
| Audit log retention (days) | `180` | Pruned by the daily cron; 0 keeps everything. |

## 6. Admin screens

- **Dashboard** — totals (first / recurring / pending / reversed), the active rules,
  configuration warnings, table health and the latest payouts.
- **Settings** — everything in the table above.
- **Commissions** — filterable payout log (affiliate, service, invoice, type, status, date
  range) with a one-click **Reverse** action.
- **Service ledger** — one row per referred service showing `first_commission_paid`, with a
  **Reset first** action for support cases.
- **Audit log** — every decision the engine made, filterable by severity.

A commission summary panel is also injected into the admin client summary page.

## 7. Edge cases

| Case | Behaviour |
|---|---|
| **Upgrade / downgrade** | The upgrade invoice item (`type = Upgrade`) resolves through `tblupgrades` back to the **same service**, so it is billed at the recurring rate and the first-payment flag is preserved. `AfterProductUpgrade`, `AfterConfigOptionsUpgrade`, `AfterModuleChangePackage` and `ServiceEdit` keep the ledger's product/group snapshot in step and write an audit note. |
| **Service moved out of the hosting group** | Future payments stop earning commission automatically (group check), and the ledger is annotated. |
| **Service moved into the hosting group** | Commission starts from the next payment; because the client is no longer new it earns the recurring rate. |
| **Refund** | `InvoiceRefunded` reverses every payout from that invoice: a still-pending commission row is deleted, an already-cleared one is debited from the balance with a negative `tblaffiliateshistory` entry. |
| **Invoice cancelled / marked unpaid** | Same reversal path (chargebacks, mistaken payments). |
| **Refunded first payment, then paid again** | The reversal clears `first_commission_paid`, so the next successful payment correctly earns the 50 % rate once — and only once. |
| **Invoice paid twice / hook replayed / cron re-run** | The `UNIQUE (invoice_id, invoice_item_id)` key rejects the second insert before any money moves. |
| **Partial payments** | Commission is raised when the invoice reaches `Paid`, never on partial payments. |
| **Invoice with mixed items** (hosting + domain + SSL) | Only the hosting line items are commissioned; the others are skipped with a logged reason. |
| **Promotion / credit on the invoice** | Discounts are distributed proportionally, so a 30 % off first invoice pays 50 % of the *discounted* amount. |
| **Affiliate system disabled / no group configured** | The engine fails closed: nothing is paid, and the dashboard shows a warning. |

## 8. Security &amp; performance

- **Duplicate payouts are structurally impossible** — the payout row (unique per invoice
  item) is inserted *before* the affiliate is credited; if crediting fails the row is rolled
  back so the commission can be retried rather than lost.
- **Fail closed** — if the duplicate check itself errors, the payout is skipped rather than
  risked twice. No group configured ⇒ no commission.
- **Admin POST actions are CSRF protected** (WHMCS `generate_token()` with a session
  fallback) and every template output is escaped.
- **All database access is Capsule/PDO with bound parameters.** The legacy WHMCS helpers
  removed in WHMCS 8 (`select_query`, `full_query`, …) are not used anywhere — the test
  suite asserts this.
- **Hook safety net** — every hook body is wrapped, so an error inside the commission engine
  can never interrupt a payment, an invoice action or the cron.
- **Cheap** — two indexed lookups per commissionable line item, in-request caches for
  services and product groups, and log pruning on the daily cron. Non-hosting and
  non-referred items short-circuit before any write.

## 9. CLI utility

```bash
cd /path/to/whmcs/modules/addons/customaffiliate

php utilities.php status                       # configuration + health
php utilities.php audit --days=30              # payout/ledger consistency check
php utilities.php report --from=2026-09-01     # commission report
php utilities.php reprocess --invoice_id=1234  # re-run the engine for one invoice
php utilities.php backfill --days=30           # dry run over historical paid invoices
php utilities.php backfill --days=30 --apply   # …and create the commissions
php utilities.php reverse --invoice_id=1234    # reverse everything on an invoice
php utilities.php reset --service_id=567       # clear the first-payment flag
```

`backfill` is safe to re-run: already-processed invoice items are rejected by the unique key.

## 10. File structure

```
modules/addons/customaffiliate/
├── customaffiliate.php          # WHMCS addon entry points (_config/_activate/_output/…)
├── bootstrap.php                # constants + PSR-4 autoloader
├── hooks.php                    # AffiliateCommission, InvoicePaid, refund/cancel, upgrades, cron
├── utilities.php                # CLI: status, audit, report, reprocess, backfill, reverse, reset
├── install/
│   ├── schema.sql               # canonical schema
│   └── migrations/2.0.0_commission_engine.sql
├── lib/
│   ├── Rules.php                # pure decision logic (first vs recurring, discounts)
│   ├── CommissionEngine.php     # process / reverse invoices, duplicate guard
│   ├── Affiliates.php           # WHMCS affiliate tables gateway (credit / reverse)
│   ├── Ledger.php               # mod_customaffiliate_commissions
│   ├── Catalog.php              # invoice item → service → product → group
│   ├── ServiceChange.php        # upgrade / downgrade / package change
│   ├── Settings.php             # settings + typed accessors + legacy import
│   ├── Installer.php            # schema, migrations, defaults, health checks
│   ├── Logger.php               # audit trail
│   └── Admin.php                # admin controller
└── templates/admin/{dashboard,settings,commissions,ledger,logs}.tpl
```

## 11. Testing

```bash
php tests/customaffiliate/run.php
```

No database, no WHMCS runtime, no PHPUnit. The suite covers the money rules (50/20,
configured rates, group scoping, new-client handling, the first-once-per-service sequence,
upgrades, post-refund re-earning, rounding, discount distribution), settings parsing and
clamping, the schema guarantees (unique keys, required columns) and the integration
contracts that the 1.x module got wrong (`invoiceid` casing, `skipCommission` return,
referrals read from `tblaffiliatesaccounts`, credits written to the real affiliate tables).

CI runs it on PHP 7.4 and 8.2 together with `php -l` over every module file and template.

## 12. Troubleshooting

| Symptom | Check |
|---|---|
| No commission at all | Dashboard warnings; is a product group ticked? is the WHMCS affiliate system enabled? was the order actually placed through an affiliate link (`tblaffiliatesaccounts` row for the service)? |
| Affiliate got the old default % | Turn **Suppress the WHMCS default commission** on, and confirm this module's `hooks.php` is present (WHMCS loads `modules/addons/*/hooks.php` automatically). |
| Commission shows as *pending* | That is the WHMCS clearing delay. It moves to the balance when the delay expires and the service is still active. |
| Renewal paid 50 % again | Look at the **Service ledger**: `first_commission_paid` was probably cleared by a refund/reversal, which is the intended behaviour. |
| Commission for a domain or RDP | Those groups must not be ticked in Settings; check the **Audit log** for the recorded reason. |
| Nothing in the audit log | Enable **Debug logging** — by default the two highest-volume skips (not referred / not hosting) are only logged in debug mode. |

---

**Version 2.0.0** · WHMCS 8.0+ · PHP 7.4+
