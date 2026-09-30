# CloudHost247 Payments — Blockonomics Cryptocurrency Gateway Management

Super Admin control surface over the **existing** Blockonomics WHMCS gateway
(`modules/gateways/blockonomics.php` + `modules/gateways/blockonomics/` +
`modules/gateways/callback/blockonomics.php`). There is exactly one authoritative
Blockonomics integration — this addon manages and hardens it; it does not duplicate it.

Admin → Addons → **CloudHost247 Payments**:

- **Blockonomics settings** (default view): gateway master switch, BTC / BCH / USDT
  enablement, USDT network + receiving address, required confirmations, payment
  expiration window, masked credential status, server-side **Test Connection**.
- **Cryptocurrency Transactions** (`&view=transactions`): read-only ledger over the
  existing `blockonomics_orders` table joined to WHMCS invoices/clients/payments, with
  search (txn / address / invoice # / email), currency/status/date filters and
  normalized statuses (Pending / Confirming / Paid / Underpaid / Expired). *Paid* is
  only displayed when a real WHMCS payment record exists. There is deliberately no
  "Mark as Paid" button.

## Where things live (nothing duplicated)

| Concern | Owner |
|---|---|
| Gateway settings (switches, confirmations, network, address, window) | Existing `tblpaymentgateways` rows, via `Blockonomics\GatewaySettings` |
| API key | **CloudHost247 API & Integrations** vault (provider `blockonomics`, AES-256-GCM); legacy WHMCS gateway `ApiKey` field remains the fallback |
| Payment execution, address generation, callbacks | Existing Blockonomics gateway |
| Financial records | Existing WHMCS `tblinvoices` / `tblaccounts` + `blockonomics_orders` |
| Audit log | Foundation `mod_cloudhost247_audit_events` (`AuditLogger`, secrets `[REDACTED]`) |
| Authorization | WHMCS admin session + Foundation capabilities `payments.configure`, `payments.gateway.test`, `payments.crypto.view` (absent rows = standard WHMCS addon permissions) |

## Enforcement model

`Blockonomics\GatewaySettings` (in the gateway itself, `modules/gateways/blockonomics/lib/`)
is the single availability rule used by the Pay Now link, the payment page, the checkout
templates, the USDT poller trigger and this admin UI:

```
effective(currency) = master switch ON
                    AND currency flag ON
                    AND API credential configured        (BTC/BCH)
                    AND valid 0x address + supported net (USDT)
```

Disabled or misconfigured methods are refused **server-side** with HTTP 403 and
"This payment method is currently unavailable." — hiding buttons is never the control.
The master switch is additive (`GatewayEnabled`); absent means ON, so existing
installations are unaffected until an administrator makes the state explicit.

USDT networks are exactly the ones the bundled implementation supports (Ethereum
mainnet, Sepolia test network — labelled as a test network). Customers always see
"USDT — <network>" plus a wrong-network loss warning beside the receiving details.

## Callback hardening (existing endpoint retained)

`modules/gateways/callback/blockonomics.php` now: authenticates with `hash_equals`,
validates the shape of `status`/`value`/`addr`/`txid` before any database access,
rejects addresses that were never issued, keeps the existing duplicate-transaction and
invoice-identity guards, and redacts the callback secret from gateway logs. Amount
handling (slack/underpayment percentage crediting) follows the existing billing rules.

## Testing

- `tests/payments/test_static.py` — executable static verification (structure,
  enforcement wiring, secrecy, audit, no-mark-as-paid, PHP balance).
- `tests/payments/run.php` — WHMCS-free behavioural tests for the availability matrix
  (configurations A–E), USDT validation and status normalization (requires PHP CLI).

## Rollback

Deactivating the addon removes nothing. Removing the `GatewayEnabled` row (or leaving it
`on`) restores pre-addon behaviour; all gateway, order and payment records are untouched.
