<?php
/**
 * Custom Affiliate Commission - WHMCS hooks.
 *
 * Hook points used
 * ----------------
 *  AffiliateCommission          suppress the WHMCS default commission so this
 *                               module is the only thing that pays out
 *  InvoicePaid                  calculate + credit commission (50% / 20%)
 *  InvoiceRefunded              reverse commission
 *  InvoiceCancelled             reverse commission
 *  InvoiceUnpaid                reverse commission (payment undone)
 *  AfterProductUpgrade          keep commission state across package changes
 *  AfterConfigOptionsUpgrade
 *  AfterModuleChangePackage
 *  ServiceEdit
 *  DailyCronJob                 audit-log housekeeping
 *
 * Every handler is wrapped so that a failure inside the commission engine can
 * never interrupt a payment, an invoice action or the cron.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';

use CustomAffiliate\CommissionEngine;
use CustomAffiliate\Logger;
use CustomAffiliate\Rules;
use CustomAffiliate\ServiceChange;
use CustomAffiliate\Settings;

/**
 * Run a hook body with a safety net.
 *
 * @param  mixed $default Returned if the callback throws.
 * @return mixed
 */
function customaffiliate_guard(string $hook, callable $callback, $default = null)
{
    try {
        return $callback();
    } catch (\Throwable $e) {
        Logger::error('Unhandled error in ' . $hook, [
            'action' => 'hook_error',
            'hook'   => $hook,
            'error'  => $e->getMessage(),
            'file'   => basename($e->getFile()) . ':' . $e->getLine(),
        ]);

        return $default;
    }
}

/**
 * Suppress the WHMCS default commission.
 *
 * WHMCS's AffiliateCommission hook cannot change the commission AMOUNT - it
 * only accepts boolean `skipCommission` / `payout` overrides. So the strategy
 * is: stop WHMCS paying anything here, and let InvoicePaid pay the correct
 * 50%/20% ourselves. That single decision is what implements both
 * "custom percentage" and "exclude every non-hosting product".
 *
 * @param array<string,mixed> $vars
 * @return array<string,bool>
 */
add_hook('AffiliateCommission', 1, function ($vars) {
    return customaffiliate_guard('AffiliateCommission', function () use ($vars) {
        if (!Settings::isEnabled() || !Settings::isExclusive()) {
            return [];
        }

        Logger::debug('Suppressed WHMCS default affiliate commission', [
            'affiliate_id'      => (int) ($vars['affiliateId'] ?? 0),
            'service_id'        => (int) ($vars['serviceId'] ?? 0),
            'referral_id'       => (int) ($vars['referralId'] ?? 0),
            'default_amount'    => (float) ($vars['commissionAmount'] ?? 0),
        ]);

        // Custom rates are applied from InvoicePaid instead.
        return ['skipCommission' => true, 'payout' => false];
    }, []);
});

/**
 * Commission is only ever earned once an invoice is actually PAID.
 *
 * @param array<string,mixed> $vars
 */
add_hook('InvoicePaid', 1, function ($vars) {
    customaffiliate_guard('InvoicePaid', function () use ($vars) {
        $invoiceId = (int) ($vars['invoiceid'] ?? 0);

        if ($invoiceId <= 0) {
            return;
        }

        $engine = new CommissionEngine();
        $summary = $engine->processInvoice($invoiceId);

        Logger::debug('InvoicePaid processed', [
            'invoice_id' => $invoiceId,
            'processed'  => $summary['processed'],
            'skipped'    => $summary['skipped'],
            'amount'     => $summary['amount'],
        ]);
    });
});

/**
 * Refund: claw the commission back.
 *
 * @param array<string,mixed> $vars
 */
add_hook('InvoiceRefunded', 1, function ($vars) {
    customaffiliate_guard('InvoiceRefunded', function () use ($vars) {
        if (!Settings::isEnabled() || !Settings::reversesOnRefund()) {
            return;
        }

        $invoiceId = (int) ($vars['invoiceid'] ?? 0);

        if ($invoiceId > 0) {
            (new CommissionEngine())->reverseInvoice($invoiceId, 'invoice refunded');
        }
    });
});

/**
 * Cancelled invoice: same treatment as a refund.
 *
 * @param array<string,mixed> $vars
 */
add_hook('InvoiceCancelled', 1, function ($vars) {
    customaffiliate_guard('InvoiceCancelled', function () use ($vars) {
        if (!Settings::isEnabled() || !Settings::reversesOnCancel()) {
            return;
        }

        $invoiceId = (int) ($vars['invoiceid'] ?? 0);

        if ($invoiceId > 0) {
            (new CommissionEngine())->reverseInvoice($invoiceId, 'invoice cancelled');
        }
    });
});

/**
 * An invoice flipped back to Unpaid (chargeback, mistaken payment, gateway
 * reversal): the commission it produced is no longer earned.
 *
 * @param array<string,mixed> $vars
 */
add_hook('InvoiceUnpaid', 1, function ($vars) {
    customaffiliate_guard('InvoiceUnpaid', function () use ($vars) {
        if (!Settings::isEnabled() || !Settings::reversesOnRefund()) {
            return;
        }

        $invoiceId = (int) ($vars['invoiceid'] ?? 0);

        if ($invoiceId > 0) {
            (new CommissionEngine())->reverseInvoice($invoiceId, 'invoice marked unpaid');
        }
    });
});

/**
 * Package changes: upgrades, downgrades and admin product swaps.
 *
 * The service keeps its ledger row, so the next payment is correctly treated
 * as a renewal rather than a brand new first payment.
 */
foreach (['AfterProductUpgrade', 'AfterConfigOptionsUpgrade', 'AfterModuleChangePackage', 'ServiceEdit'] as $packageHook) {
    add_hook($packageHook, 1, function ($vars) use ($packageHook) {
        customaffiliate_guard($packageHook, function () use ($vars, $packageHook) {
            $serviceId = ServiceChange::resolveServiceId((array) $vars);

            if ($serviceId > 0) {
                ServiceChange::handle($serviceId, strtolower(str_replace('After', '', $packageHook)));
            }
        });
    });
}

/**
 * Daily housekeeping. The commission work itself is event driven (InvoicePaid
 * fires for cron-generated renewal payments too), so the cron only prunes the
 * audit log.
 */
add_hook('DailyCronJob', 1, function ($vars) {
    customaffiliate_guard('DailyCronJob', function () {
        $retention = Settings::getInt('log_retention_days', 180);
        $pruned = Logger::prune($retention);

        if ($pruned > 0) {
            Logger::debug('Pruned audit log', ['rows' => $pruned, 'retention_days' => $retention]);
        }
    });
});

/**
 * Expose a short commission summary in the client's admin sidebar.
 *
 * @param array<string,mixed> $vars
 * @return array<string,string>
 */
add_hook('AdminAreaClientSummaryPage', 1, function ($vars) {
    return customaffiliate_guard('AdminAreaClientSummaryPage', function () use ($vars) {
        if (!Settings::isEnabled()) {
            return '';
        }

        $clientId = (int) ($vars['userid'] ?? 0);

        if ($clientId <= 0) {
            return '';
        }

        $payouts = CommissionEngine::payouts(['client_id' => $clientId], 100);

        if (!$payouts) {
            return '';
        }

        $first = 0.0;
        $recurring = 0.0;

        foreach ($payouts as $payout) {
            if ($payout->status === 'reversed') {
                continue;
            }

            if ($payout->commission_type === Rules::TYPE_FIRST) {
                $first += (float) $payout->amount;
            } else {
                $recurring += (float) $payout->amount;
            }
        }

        return '<div class="panel panel-default">'
            . '<div class="panel-heading"><strong>Affiliate commission</strong></div>'
            . '<div class="panel-body">'
            . 'First payment: <strong>' . number_format($first, 2) . '</strong><br>'
            . 'Renewals: <strong>' . number_format($recurring, 2) . '</strong><br>'
            . '<span class="text-muted">' . count($payouts) . ' payout record(s)</span>'
            . '</div></div>';
    }, '');
});
