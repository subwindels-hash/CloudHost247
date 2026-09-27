<?php

/**
 * Custom Affiliate Commission - Utility Script
 *
 * This script can be run manually or via cron for maintenance tasks:
 * - Audit all commission records for integrity
 * - Fix orphaned records
 * - Generate commission reports
 *
 * Usage: php /path/to/whmcs/modules/addons/customaffiliate/utilities.php [command] [options]
 *
 * Commands:
 *   audit      - Audit all commission records
 *   report     - Generate commission report for date range
 *   reset      - Reset a specific service's commission status (requires --service_id)
 *   fixrefund  - Re-process refunds that may have been missed
 */

if (!defined("WHMCS")) {
    define("WHMCS", true);
}

// Bootstrap WHMCS (adjust path as needed)
$whmcsRoot = dirname(__DIR__, 4); // Navigate to WHMCS root from modules/addons/customaffiliate/
if (!file_exists($whmcsRoot . '/init.php')) {
    // Try current directory structure
    $whmcsRoot = realpath(__DIR__ . '/../../../../');
}

if (!file_exists($whmcsRoot . '/init.php')) {
    die("Cannot find WHMCS init.php. Please run this script from the WHMCS server.\n");
}

require_once $whmcsRoot . '/init.php';

use WHMCS\Database\Capsule;
use CustomAffiliate\CommissionManager;
use CustomAffiliate\UpgradeHandler;

// Include our classes
require_once __DIR__ . '/lib/CommissionManager.php';
require_once __DIR__ . '/lib/UpgradeHandler.php';

// Parse command line arguments
$command = $argv[1] ?? 'help';
$options = getopt('', ['service_id:', 'start_date:', 'end_date:', 'affiliate_id:']);

$manager = new CommissionManager();
$handler = new UpgradeHandler();

switch ($command) {
    case 'audit':
        echo "Starting commission audit...\n";
        $stats = $handler->auditAllServices();
        echo "Audit complete:\n";
        echo "  Records checked: {$stats['checked']}\n";
        echo "  Fixes applied: {$stats['fixed']}\n";
        if (!empty($stats['errors'])) {
            echo "  Errors: " . implode(', ', $stats['errors']) . "\n";
        }
        break;

    case 'report':
        $startDate = $options['start_date'] ?? date('Y-m-d', strtotime('-30 days'));
        $endDate = $options['end_date'] ?? date('Y-m-d');
        $affiliateId = $options['affiliate_id'] ?? null;

        echo "Generating commission report from {$startDate} to {$endDate}\n";

        try {
            $query = Capsule::table('mod_customaffiliate_log')
                ->whereBetween('created_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
                ->where('action', 'like', '%_commission');

            if ($affiliateId) {
                $query->where('affiliate_id', $affiliateId);
                echo "Filtered for Affiliate ID: {$affiliateId}\n";
            }

            $records = $query->orderBy('created_at', 'desc')->get();

            echo str_repeat('-', 80) . "\n";
            printf("%-20s %-12s %-12s %-12s %-10s %s\n",
                'Date', 'Service', 'Affiliate', 'Invoice', 'Amount', 'Type');
            echo str_repeat('-', 80) . "\n";

            $total = 0;
            foreach ($records as $record) {
                $type = str_replace('_commission', '', $record->action);
                printf("%-20s %-12s %-12s %-12s $%-9.2f %s\n",
                    $record->created_at,
                    $record->service_id ?: '-',
                    $record->affiliate_id ?: '-',
                    $record->invoice_id ?: '-',
                    $record->amount,
                    ucfirst($type)
                );
                $total += $record->amount;
            }

            echo str_repeat('-', 80) . "\n";
            echo "Total Commissions: $" . number_format($total, 2) . "\n";
            echo "Total Records: " . count($records) . "\n";

        } catch (Exception $e) {
            echo "Error generating report: " . $e->getMessage() . "\n";
        }
        break;

    case 'reset':
        $serviceId = $options['service_id'] ?? null;
        if (!$serviceId) {
            echo "ERROR: --service_id is required for reset command\n";
            exit(1);
        }

        echo "Resetting commission status for service {$serviceId}...\n";

        try {
            $affected = Capsule::table('mod_customaffiliate_commissions')
                ->where('service_id', $serviceId)
                ->update([
                    'first_commission_paid' => false,
                    'first_commission_paid_at' => null,
                    'first_commission_invoice_id' => null,
                    'notes' => Capsule::raw("CONCAT(notes, ' | Manual reset via utility script on " . date('Y-m-d H:i:s') . "')"),
                ]);

            echo "Updated {$affected} record(s).\n";
            echo "Next payment for this service will be treated as FIRST payment (50%).\n";

        } catch (Exception $e) {
            echo "Error resetting service: " . $e->getMessage() . "\n";
            exit(1);
        }
        break;

    case 'fixrefund':
        echo "Checking for refunds that may need commission reversal...\n";

        try {
            // Find refunded invoices that have commission records
            $refundedInvoices = Capsule::table('tblinvoices')
                ->where('status', 'Refunded')
                ->get();

            $fixed = 0;
            foreach ($refundedInvoices as $invoice) {
                $hasCommission = Capsule::table('mod_customaffiliate_commissions')
                    ->where('first_commission_invoice_id', $invoice->id)
                    ->where('first_commission_paid', true)
                    ->exists();

                if ($hasCommission) {
                    $manager->handleInvoiceRefund($invoice->id);
                    $fixed++;
                    echo "Fixed refund for invoice {$invoice->id}\n";
                }
            }

            echo "Refund fix complete. Processed {$fixed} invoice(s).\n";

        } catch (Exception $e) {
            echo "Error processing refunds: " . $e->getMessage() . "\n";
        }
        break;

    case 'help':
    default:
        echo "Custom Affiliate Commission - Utility Script\n\n";
        echo "Usage: php utilities.php [command] [options]\n\n";
        echo "Commands:\n";
        echo "  audit                  Audit all commission records for integrity\n";
        echo "  report                 Generate commission report\n";
        echo "    --start_date=DATE    Start date (YYYY-MM-DD)\n";
        echo "    --end_date=DATE      End date (YYYY-MM-DD)\n";
        echo "    --affiliate_id=ID    Filter by affiliate ID\n";
        echo "  reset                  Reset commission status for a service\n";
        echo "    --service_id=ID      Required: Service ID to reset\n";
        echo "  fixrefund              Find and fix missed refund reversals\n";
        echo "  help                   Show this help message\n";
        break;
}

echo "\nDone.\n";
