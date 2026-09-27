<?php

/**
 * Custom Affiliate Commission Hooks
 *
 * Integrates with WHMCS core via hooks:
 * - InvoicePaid: Triggers commission calculation after invoice is paid
 * - AffiliateCommission: Overrides default commission calculation
 * - InvoiceRefunded: Reverses commissions on refund
 * - AfterModuleUpgrade/Downgrade: Handles service changes
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

use WHMCS\Database\Capsule;

// Autoloader for our class
require_once __DIR__ . '/lib/CommissionManager.php';

/**
 * Hook: InvoicePaid
 * Triggered after an invoice is marked as paid
 */
add_hook('InvoicePaid', 1, function($vars) {
    $invoiceId = $vars['invoiceId'];

    $manager = new \CustomAffiliate\CommissionManager();
    $manager->logDebug('InvoicePaid hook fired', ['invoice_id' => $invoiceId]);

    try {
        $commissions = $manager->processInvoicePaid($invoiceId);

        if ($commissions && is_array($commissions)) {
            foreach ($commissions as $commission) {
                // Prevent duplicate commissions
                if ($manager->isDuplicateCommission(
                    $commission['invoice_id'],
                    $commission['service_id'],
                    $commission['affiliate_id']
                )) {
                    $manager->logDebug('Duplicate commission detected - skipping', [
                        'invoice_id' => $commission['invoice_id'],
                        'service_id' => $commission['service_id'],
                    ]);
                    continue;
                }

                // Record the commission in our tracking system
                $manager->recordCommission($commission);

                $manager->logDebug('Commission recorded successfully', [
                    'type' => $commission['commission_type'],
                    'amount' => $commission['commission_amount'],
                ]);
            }
        }
    } catch (Exception $e) {
        $manager->logDebug('Exception in InvoicePaid hook', [
            'error' => $e->getMessage(),
            'trace' => $e->getTraceAsString(),
        ]);
    }
});

/**
 * Hook: AffiliateCommission
 * Overrides the default affiliate commission calculation
 *
 * This hook allows us to modify or replace WHMCS's default commission amount.
 * Return a numeric value to set the commission, or false to use default WHMCS calculation.
 * Return 0 to give no commission.
 */
add_hook('AffiliateCommission', 1, function($vars) {
    $manager = new \CustomAffiliate\CommissionManager();
    $manager->logDebug('AffiliateCommission hook fired', $vars);

    try {
        $result = $manager->handleAffiliateCommissionHook($vars);

        if ($result === false) {
            // Use default WHMCS calculation
            $manager->logDebug('Using default WHMCS commission calculation');
            return false;
        }

        if ($result === 0 || $result === 0.00) {
            // Explicitly zero commission for non-hosting products
            $manager->logDebug('Commission zeroed for non-web-hosting product');
            return 0;
        }

        $manager->logDebug('Custom commission override applied', ['amount' => $result]);
        return $result;

    } catch (Exception $e) {
        $manager->logDebug('Exception in AffiliateCommission hook', [
            'error' => $e->getMessage(),
        ]);
        return false; // Fallback to default on error
    }
});

/**
 * Hook: InvoiceRefunded
 * Reverses affiliate commission when invoice is refunded
 */
add_hook('InvoiceRefunded', 1, function($vars) {
    $invoiceId = $vars['invoiceId'];
    $refundType = $vars['type'] ?? 'unknown'; // 'Partial' or 'Full'
    $refundAmount = $vars['refundAmount'] ?? 0;

    $manager = new \CustomAffiliate\CommissionManager();
    $manager->logDebug('InvoiceRefunded hook fired', [
        'invoice_id' => $invoiceId,
        'refund_type' => $refundType,
        'refund_amount' => $refundAmount,
    ]);

    try {
        $manager->handleInvoiceRefund($invoiceId);
    } catch (Exception $e) {
        $manager->logDebug('Exception in InvoiceRefunded hook', [
            'error' => $e->getMessage(),
        ]);
    }
});

/**
 * Hook: AfterModuleUpgrade
 * Handles commission logic when a hosting service is upgraded
 */
add_hook('AfterModuleUpgrade', 1, function($vars) {
    $serviceId = $vars['params']['serviceid'] ?? 0;
    if (!$serviceId) {
        return;
    }

    $manager = new \CustomAffiliate\CommissionManager();
    $manager->logDebug('AfterModuleUpgrade hook fired', ['service_id' => $serviceId]);

    try {
        $manager->handleServiceChange($serviceId, 'upgrade');
    } catch (Exception $e) {
        $manager->logDebug('Exception in AfterModuleUpgrade hook', [
            'error' => $e->getMessage(),
        ]);
    }
});

/**
 * Hook: AfterModuleDowngrade
 * Handles commission logic when a hosting service is downgraded
 */
add_hook('AfterModuleDowngrade', 1, function($vars) {
    $serviceId = $vars['params']['serviceid'] ?? 0;
    if (!$serviceId) {
        return;
    }

    $manager = new \CustomAffiliate\CommissionManager();
    $manager->logDebug('AfterModuleDowngrade hook fired', ['service_id' => $serviceId]);

    try {
        $manager->handleServiceChange($serviceId, 'downgrade');
    } catch (Exception $e) {
        $manager->logDebug('Exception in AfterModuleDowngrade hook', [
            'error' => $e->getMessage(),
        ]);
    }
});

/**
 * Hook: PreCronJob
 * Daily cron compatibility - log that module is active during cron
 */
add_hook('PreCronJob', 1, function($vars) {
    // This hook ensures our module is loaded during cron execution
    // The actual cron-related logic is handled by InvoicePaid which fires
    // when the cron marks renewal invoices as paid
});

/**
 * Hook: ClientAreaPage
 * Handle affiliate cookie tracking for new client registrations
 */
add_hook('ClientAreaPage', 1, function($vars) {
    // This is a lightweight hook to ensure affiliate tracking is active
    // WHMCS handles affiliate cookie tracking natively via tblclients.affiliateid
    return [];
});

/**
 * Hook: OrderPaid
 * Additional hook for order-level commission processing
 */
add_hook('OrderPaid', 1, function($vars) {
    $orderId = $vars['orderId'];
    $invoiceId = $vars['invoiceId'] ?? 0;

    $manager = new \CustomAffiliate\CommissionManager();
    $manager->logDebug('OrderPaid hook fired', [
        'order_id' => $orderId,
        'invoice_id' => $invoiceId,
    ]);

    // The InvoicePaid hook handles the actual commission calculation
    // This hook is for additional logging or future extensions
});
