# CloudHost247 Cart Recovery

Native WHMCS addon for abandoned-cart snapshots, recovery links, reminders and conversion reporting. WHMCS remains the source of truth for the cart and order; the Node cart service is not modified.

## Install

Copy this directory to `modules/addons/`, activate **CloudHost247 Cart Recovery** in WHMCS, and grant the normal WHMCS addon permission. Activation creates only `mod_cloudhost247_cart_recovery_*` tables and creates three editable general WHMCS email templates. Deactivation is non-destructive.

## Cron

Run every five minutes using the PHP binary and absolute path used by the deployment:

```cron
*/5 * * * * php /absolute/path/to/whmcs/modules/addons/cloudhost247_cart_recovery/cron.php >> /absolute/path/to/whmcs/storage/logs/cart-recovery.log 2>&1
```

The worker batches records, has a database lock, and uses a unique `(recovery_id, reminder_number)` log key. Failed deliveries are logged and can be retried on the next controlled run; no SMTP credentials are introduced. Delivery uses WHMCS `SendEmail` and the normal WHMCS mail configuration.

## Configuration and lifecycle

Defaults are one-hour abandonment threshold, reminders at 1, 24 and 72 hours after abandonment, three reminders and seven-day token lifetime. The addon screen stores values in seconds and allows disabling individual reminders, guest tracking and unsubscribe. Capture hooks are defensive and never interrupt checkout. Empty or changed carts reset the active lifecycle; expired links and suppressed recipients are terminal.

Authenticated carts are keyed by client ID; guest attempts are keyed by the WHMCS session and only become eligible once an email is supplied by checkout. Recovery restores only the sanitized `$_SESSION['cart']` shape and never authenticates the visitor. Tokens are 256-bit random values: lookup uses SHA-256 and the delivery token is sealed with WHMCS encryption for later cron delivery. It is never logged or exposed in admin.

`AfterShoppingCartCheckout` and `OrderPaid` stop reminders and copy revenue from `tblorders.amount` when available, not from the browser snapshot. The dashboard defines recovery rate as `(recovered + converted) / (abandoned + recovered + converted)` and reports zero for empty datasets.

## Troubleshooting and upgrades

Check the WHMCS module log, PHP error log and the reminder log table. Confirm `localAPI('SendEmail')` and email templates are enabled. Migrations are guarded and repeatable; future migrations should be added as versioned files and invoked from activation. Do not delete the tables during an uninstall unless a separate, explicit destructive operation is introduced.
