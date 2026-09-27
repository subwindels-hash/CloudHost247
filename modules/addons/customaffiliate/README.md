# Custom Affiliate Commission Module for WHMCS

## Overview

This WHMCS addon module modifies the default affiliate commission system with a custom two-tier commission structure specifically for **Web Hosting** products:

- **50% commission** on the **FIRST successful payment** per service
- **20% commission** on all **RECURRING payments** (renewals) for the same service
- **Zero commission** for all non-hosting products (domains, RDP, email, SSL, etc.)

## Features

- Product group filtering (only "Web Hosting" group generates commissions)
- First vs recurring payment detection
- Duplicate commission prevention
- Automatic commission reversal on refunds
- Upgrade/downgrade support
- Admin dashboard with statistics
- Full audit trail logging
- WHMCS cron job compatible
- WHMCS coding standards compliant

## File Structure

```
/modules/addons/customaffiliate/
├── customaffiliate.php          # Main addon module file
├── hooks.php                    # WHMCS hook registrations
├── lib/
│   └── CommissionManager.php    # Core business logic class
├── schema.sql                   # Database schema (optional manual install)
└── README.md                    # This file
```

## Requirements

- WHMCS 8.0 or higher
- PHP 7.4 or higher (PHP 8.x supported)
- MySQL 5.7+ / MariaDB 10.3+
- Properly configured WHMCS Affiliate System (enabled in Setup > General Settings > Affiliates)

## Installation

### Step 1: Upload Files

1. Download and extract the module files.
2. Upload the `customaffiliate` folder to your WHMCS installation at:
   ```
   /modules/addons/customaffiliate/
   ```
3. Ensure the permissions are correct:
   ```bash
   chmod -R 755 /modules/addons/customaffiliate/
   chown -R www-data:www-data /modules/addons/customaffiliate/
   ```

### Step 2: Run Database Schema (Optional but Recommended)

The module will attempt to create tables automatically on activation, but for best results, run the schema first:

```bash
mysql -u your_username -p your_whmcs_database < /modules/addons/customaffiliate/schema.sql
```

Or import `schema.sql` via phpMyAdmin.

### Step 3: Activate the Module

1. Log in to your **WHMCS Admin Panel**
2. Navigate to: **System Settings > Addon Modules**
3. Find **"Custom Affiliate Commission"** in the list
4. Click **Activate**
5. Configure the module settings:
   - **Web Hosting Product Group**: Select your Web Hosting product group from the dropdown
   - **First Commission Percentage**: Enter `50` (default)
   - **Recurring Commission Percentage**: Enter `20` (default)
   - **Enable Debug Logging**: Enable for initial testing
6. Click **Save Changes**

### Step 4: Verify Setup

1. Go to **Addons > Custom Affiliate Commission** in the admin menu
2. Confirm the dashboard loads and shows configuration summary
3. Check that your product group is correctly selected
4. Review recent activity logs after a test transaction

## Configuration Details

### Finding Your Web Hosting Product Group ID

Option 1: In module settings dropdown (recommended)
- The dropdown auto-populates with all product groups

Option 2: Via database
```sql
SELECT id, name FROM tblproductgroups;
```

Option 3: In WHMCS Admin
- **Configuration > System Settings > Products/Services > Product Groups**
- Hover over edit link to see the ID in the URL

## How It Works

### Commission Flow

```
Client clicks affiliate link
        |
        v
WHMCS sets affiliate cookie (affid)
        |
        v
Client places order for Web Hosting product
        |
        v
Invoice generated and marked PAID
        |
        v
InvoicePaid hook fires
        |
        v
Module checks: Is product in Web Hosting group?
        |-- NO -> Commission = $0 (default override returns 0)
        |-- YES -> Continue
        |
        v
Module checks: First payment or recurring?
        |-- First payment -> 50% commission
        |-- Recurring payment -> 20% commission
        |
        v
Record stored in mod_customaffiliate_commissions
        |
        v
Commission applied to affiliate account
```

### First vs Recurring Detection

The module uses a custom database table to track commission status per service/affiliate pair:

- **No record exists** → First payment (50%)
- **Record exists, first_commission_paid = 0** → First payment (50%)
- **Record exists, first_commission_paid = 1** → Recurring payment (20%)

### Affiliate Tracking

WHMCS natively handles affiliate tracking via:
- `tblclients.affiliateid` - stores the referring affiliate for each client
- Affiliate cookies during signup

This module reads that relationship to determine which affiliate should receive commission.

## Hook Reference

| Hook | Priority | Purpose |
|------|----------|---------|
| `InvoicePaid` | 1 | Main trigger for commission calculation |
| `AffiliateCommission` | 1 | Overrides default WHMCS commission amount |
| `InvoiceRefunded` | 1 | Reverses commissions on refund |
| `AfterModuleUpgrade` | 1 | Tracks service upgrades |
| `AfterModuleDowngrade` | 1 | Tracks service downgrades |
| `OrderPaid` | 1 | Additional order-level logging |

## Edge Cases Handled

### Upgrades / Downgrades
When a client upgrades or downgrades their hosting service:
- The module logs the change in the notes field
- If the new product is still in the Web Hosting group, commissions continue normally
- If the new product moves to a different group, future commissions are blocked (group check fails)
- Existing first-commission-paid status is preserved

### Refunds
When an invoice is refunded:
- The `InvoiceRefunded` hook fires
- The module finds the linked commission record
- The `first_commission_paid` flag is reset to allow re-commissioning if the client pays again
- A negative audit log entry is created
- Note: For partial refunds, the full first commission flag is reset (conservative approach)

### Duplicate Prevention
Before recording any commission:
- The module checks `mod_customaffiliate_log` for existing commission entries with the same invoice + service + affiliate combination
- If found, the commission is skipped
- This prevents double-payouts from race conditions or hook re-fires

### Cron Job Compatibility
The module is fully compatible with WHMCS cron:
- The `PreCronJob` hook ensures module availability during automated tasks
- When the cron marks recurring invoices as Paid, `InvoicePaid` fires normally
- All commission logic executes identically for manual payments and cron-processed payments

## Database Schema Reference

### mod_customaffiliate_commissions

| Column | Type | Description |
|--------|------|-------------|
| `id` | int | Primary key |
| `service_id` | int | WHMCS hosting service ID |
| `affiliate_id` | int | WHMCS affiliate account ID |
| `client_id` | int | WHMCS client ID |
| `product_id` | int | WHMCS product/package ID |
| `first_commission_amount` | decimal | Amount of first commission paid |
| `first_commission_paid` | bool | Flag indicating if first commission was paid |
| `first_commission_invoice_id` | int | Invoice ID linked to first commission |
| `first_commission_paid_at` | datetime | Timestamp of first commission |
| `total_recurring_commission` | decimal | Running total of all recurring commissions |
| `recurring_count` | int | Number of recurring commission payments |
| `last_commission_at` | datetime | Timestamp of most recent commission |
| `notes` | text | Internal notes (upgrades, downgrades, etc.) |
| `created_at` | timestamp | Record creation time |
| `updated_at` | timestamp | Record last update time |

### mod_customaffiliate_log

| Column | Type | Description |
|--------|------|-------------|
| `id` | int | Primary key |
| `service_id` | int | Related service ID |
| `affiliate_id` | int | Related affiliate ID |
| `invoice_id` | int | Related invoice ID |
| `action` | varchar | Action type: first_commission, recurring_commission, refund |
| `amount` | decimal | Commission or refund amount |
| `percentage` | decimal | Commission percentage applied |
| `description` | text | Human-readable description |
| `created_at` | timestamp | Event timestamp |

## Troubleshooting

### Commissions Not Being Applied

1. **Check module activation**: Ensure module is active in Addon Modules
2. **Verify product group**: Confirm the correct product group ID is selected in settings
3. **Check affiliate relationship**: Verify the client has `affiliateid` set in `tblclients`
4. **Check debug logs**: Look at **System Logs > Activity Log** for `[CustomAffiliate]` entries
5. **Verify invoice status**: Commission only triggers on invoices marked "Paid"
6. **Check for duplicates**: Verify the commission hasn't already been recorded in `mod_customaffiliate_log`

### Wrong Commission Percentage

1. Check module settings for correct first/recurring percentages
2. Check `mod_customaffiliate_commissions` to see if `first_commission_paid` is set correctly
3. A refunded invoice resets the first commission flag - client may have gotten first-commission rate again

### Non-Hosting Products Getting Commission

- If default WHMCS commission still applies to non-hosting products, ensure the `AffiliateCommission` hook is properly loading
- Check that `hooks.php` is in the correct addon module directory (not `/includes/hooks/`)
- The hook returns `0` for non-hosting products, which should zero the commission

### Performance Considerations

- Tables are indexed on `service_id`, `affiliate_id`, `client_id`, and `first_commission_paid`
- The unique constraint on `service_id + affiliate_id` prevents duplicate tracking records
- Consider adding a cron job to archive old log entries if you have very high volume

## Uninstallation

1. Navigate to **System Settings > Addon Modules**
2. Find **"Custom Affiliate Commission"**
3. Click **Deactivate**
4. Tables are **preserved** during deactivation for data integrity
5. To completely remove data:
   ```sql
   DROP TABLE IF EXISTS `mod_customaffiliate_commissions`;
   DROP TABLE IF EXISTS `mod_customaffiliate_log`;
   DELETE FROM `tbladdonmodules` WHERE `module` = 'customaffiliate';
   DELETE FROM `tblactivitylog` WHERE `description` LIKE '%CustomAffiliate%';
   ```
6. Delete the folder: `/modules/addons/customaffiliate/`

## Security Notes

- All database queries use WHMCS Capsule (Laravel Eloquent) for parameterized queries
- No direct user input is used in queries without validation
- Module files should have proper file permissions (644 for PHP files, 755 for directories)
- Admin area output uses WHMCS native styling and escapes output implicitly through WHMCS framework

## WHMCS Version Compatibility

| WHMCS Version | Status |
|--------------|--------|
| 8.0.x - 8.1.x | Supported |
| 8.2.x - 8.4.x | Supported |
| 8.5.x - 8.8.x | Supported |
| 8.9.x+ | Supported (test recommended) |

## License

This module is provided as-is for use with your WHMCS installation. Modify as needed for your specific business requirements.

## Support

For issues related to this module:
1. Check the debug logs in Activity Log first
2. Verify your WHMCS version compatibility
3. Check database table integrity
4. Review hook firing order if conflicts with other modules exist
