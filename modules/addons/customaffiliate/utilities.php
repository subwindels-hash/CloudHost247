<?php
/**
 * Custom Affiliate Commission - command line utility.
 *
 * Maintenance and back-fill tasks that are easier from a shell than from the
 * admin area. CLI only: it refuses to run over HTTP.
 *
 *   php utilities.php status
 *   php utilities.php audit [--days=30]
 *   php utilities.php report [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--affiliate_id=N]
 *   php utilities.php reprocess --invoice_id=N
 *   php utilities.php backfill [--days=30] [--apply]
 *   php utilities.php reverse --invoice_id=N
 *   php utilities.php reset --service_id=N
 *
 * `backfill` re-runs the engine over invoices paid in the last N days. It is a
 * dry run unless --apply is given; the unique key on the payout table means it
 * can never double-pay an invoice that was already processed.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    die('This utility can only be run from the command line.');
}

// Locate and boot WHMCS (modules/addons/customaffiliate -> WHMCS root).
$whmcsRoot = null;

for ($levels = 3; $levels <= 6; $levels++) {
    $candidate = dirname(__DIR__, $levels);

    if (is_file($candidate . '/init.php')) {
        $whmcsRoot = $candidate;
        break;
    }
}

if ($whmcsRoot === null) {
    fwrite(STDERR, "Could not locate the WHMCS init.php from " . __DIR__ . "\n");
    exit(1);
}

require_once $whmcsRoot . '/init.php';
require_once __DIR__ . '/bootstrap.php';

use CustomAffiliate\Affiliates;
use CustomAffiliate\CommissionEngine;
use CustomAffiliate\Installer;
use CustomAffiliate\Ledger;
use CustomAffiliate\Rules;
use CustomAffiliate\Settings;
use WHMCS\Database\Capsule;

$command = $argv[1] ?? 'help';
$options = getopt('', ['invoice_id:', 'service_id:', 'affiliate_id:', 'from:', 'to:', 'days:', 'apply']);

/**
 * @param array<int,array<int,string>> $rows
 */
function customaffiliate_cli_table(array $header, array $rows): void
{
    $widths = [];

    foreach (array_merge([$header], $rows) as $row) {
        foreach ($row as $index => $cell) {
            $widths[$index] = max($widths[$index] ?? 0, strlen((string) $cell));
        }
    }

    $line = static function (array $row) use ($widths): string {
        $cells = [];

        foreach ($row as $index => $cell) {
            $cells[] = str_pad((string) $cell, $widths[$index]);
        }

        return '  ' . implode('  ', $cells);
    };

    echo $line($header) . "\n";
    echo '  ' . str_repeat('-', array_sum($widths) + 2 * count($widths)) . "\n";

    foreach ($rows as $row) {
        echo $line($row) . "\n";
    }
}

switch ($command) {
    // ------------------------------------------------------------------
    case 'status':
        echo "Custom Affiliate Commission " . CUSTOMAFFILIATE_VERSION . "\n\n";
        echo "  Module enabled      : " . (Settings::isEnabled() ? 'yes' : 'no') . "\n";
        echo "  Exclusive mode      : " . (Settings::isExclusive() ? 'yes' : 'no') . "\n";
        echo "  WHMCS affiliates    : " . (Affiliates::systemEnabled() ? 'enabled' : 'DISABLED') . "\n";
        echo "  Product groups      : " . (implode(', ', Settings::productGroupIds()) ?: 'NONE CONFIGURED') . "\n";
        echo "  First payment rate  : " . Settings::firstRate() . "%\n";
        echo "  Recurring rate      : " . Settings::recurringRate() . "%\n";
        echo "  Clearing delay      : " . Settings::commissionDelayDays() . " day(s)\n";
        echo "  New clients only    : " . (Settings::requiresNewClient() ? 'yes' : 'no') . "\n\n";

        foreach (Installer::tableStatus() as $table => $present) {
            echo '  ' . str_pad($table, 34) . ($present ? 'ok' : 'MISSING') . "\n";
        }

        $warnings = Installer::healthWarnings();

        if ($warnings) {
            echo "\nWarnings:\n";

            foreach ($warnings as $warning) {
                echo '  ! ' . $warning . "\n";
            }
        }

        exit(0);

    // ------------------------------------------------------------------
    case 'audit':
        $days = max(1, (int) ($options['days'] ?? 30));
        $since = date('Y-m-d 00:00:00', strtotime('-' . $days . ' days'));

        $payouts = Capsule::table(CommissionEngine::PAYOUTS_TABLE)
            ->where('created_at', '>=', $since)
            ->get();

        $problems = 0;
        $rows = [];

        foreach ($payouts as $payout) {
            $issues = [];

            $invoice = Capsule::table('tblinvoices')->where('id', (int) $payout->invoice_id)->first();

            if (!$invoice) {
                $issues[] = 'invoice missing';
            } elseif ($invoice->status !== 'Paid' && $payout->status !== 'reversed') {
                $issues[] = 'invoice is ' . $invoice->status . ' but commission stands';
            }

            if ($payout->status === 'pending' && $payout->pending_id) {
                $pendingExists = Capsule::table('tblaffiliatespending')->where('id', (int) $payout->pending_id)->exists();

                if (!$pendingExists) {
                    $issues[] = 'pending row cleared by WHMCS (expected)';
                }
            }

            $ledger = Capsule::table(Ledger::TABLE)->where('id', (int) $payout->ledger_id)->first();

            if (!$ledger) {
                $issues[] = 'ledger row missing';
            } elseif ($payout->commission_type === Rules::TYPE_FIRST
                && $payout->status !== 'reversed'
                && !$ledger->first_commission_paid) {
                $issues[] = 'first commission paid but ledger flag clear';
            }

            if ($issues) {
                $problems++;
                $rows[] = [
                    '#' . $payout->id,
                    'inv ' . $payout->invoice_id,
                    'svc ' . $payout->service_id,
                    $payout->commission_type,
                    number_format((float) $payout->amount, 2),
                    implode('; ', $issues),
                ];
            }
        }

        echo "Audited " . count($payouts) . " payout(s) from the last {$days} day(s).\n\n";

        if ($rows) {
            customaffiliate_cli_table(['PAYOUT', 'INVOICE', 'SERVICE', 'TYPE', 'AMOUNT', 'ISSUES'], $rows);
        } else {
            echo "  No inconsistencies found.\n";
        }

        exit($problems > 0 ? 1 : 0);

    // ------------------------------------------------------------------
    case 'report':
        $filters = [
            'from'         => (string) ($options['from'] ?? date('Y-m-01')),
            'to'           => (string) ($options['to'] ?? date('Y-m-d')),
            'affiliate_id' => (int) ($options['affiliate_id'] ?? 0),
        ];

        $payouts = CommissionEngine::payouts($filters, 1000);
        $totals = CommissionEngine::totals($filters);

        echo "Commission report {$filters['from']} .. {$filters['to']}\n\n";

        $rows = [];

        foreach ($payouts as $payout) {
            $rows[] = [
                substr((string) $payout->created_at, 0, 10),
                'aff ' . $payout->affiliate_id,
                'svc ' . $payout->service_id,
                'inv ' . $payout->invoice_id,
                $payout->commission_type,
                number_format((float) $payout->base_amount, 2),
                $payout->rate . '%',
                number_format((float) $payout->amount, 2),
                $payout->status,
            ];
        }

        if ($rows) {
            customaffiliate_cli_table(
                ['DATE', 'AFFILIATE', 'SERVICE', 'INVOICE', 'TYPE', 'BASE', 'RATE', 'COMMISSION', 'STATUS'],
                $rows
            );
        }

        echo "\n  Payouts   : " . $totals['payouts'] . "\n";
        echo "  First     : " . number_format($totals['first'], 2) . "\n";
        echo "  Recurring : " . number_format($totals['recurring'], 2) . "\n";
        echo "  Reversed  : -" . number_format($totals['reversed'], 2) . "\n";
        exit(0);

    // ------------------------------------------------------------------
    case 'reprocess':
        $invoiceId = (int) ($options['invoice_id'] ?? 0);

        if ($invoiceId <= 0) {
            fwrite(STDERR, "--invoice_id is required\n");
            exit(1);
        }

        $summary = (new CommissionEngine())->processInvoice($invoiceId);

        echo "Invoice #{$invoiceId}: {$summary['processed']} paid, {$summary['skipped']} skipped, "
            . number_format($summary['amount'], 2) . " total.\n";

        foreach ($summary['details'] as $detail) {
            echo '  item ' . $detail['invoice_item_id'] . ': '
                . (!empty($detail['eligible'])
                    ? ($detail['type'] . ' ' . number_format((float) $detail['amount'], 2))
                    : ('skipped (' . $detail['reason'] . ')'))
                . "\n";
        }

        exit(0);

    // ------------------------------------------------------------------
    case 'backfill':
        $days = max(1, (int) ($options['days'] ?? 30));
        $apply = isset($options['apply']);
        $since = date('Y-m-d 00:00:00', strtotime('-' . $days . ' days'));

        $invoices = Capsule::table('tblinvoices')
            ->where('status', 'Paid')
            ->where('datepaid', '>=', $since)
            ->orderBy('id')
            ->pluck('id');

        echo ($apply ? 'Backfilling ' : 'DRY RUN over ') . count($invoices)
            . " paid invoice(s) since {$since}.\n";

        $engine = new CommissionEngine();
        $processed = 0;
        $amount = 0.0;

        foreach ($invoices as $invoiceId) {
            if (!$apply) {
                $existing = Capsule::table(CommissionEngine::PAYOUTS_TABLE)
                    ->where('invoice_id', (int) $invoiceId)
                    ->exists();

                if (!$existing) {
                    echo "  invoice #{$invoiceId}: would be evaluated\n";
                }

                continue;
            }

            $summary = $engine->processInvoice((int) $invoiceId);

            if ($summary['processed'] > 0) {
                $processed += $summary['processed'];
                $amount += $summary['amount'];
                echo "  invoice #{$invoiceId}: {$summary['processed']} commission(s), "
                    . number_format($summary['amount'], 2) . "\n";
            }
        }

        if ($apply) {
            echo "\nCreated {$processed} commission(s) worth " . number_format($amount, 2) . ".\n";
        } else {
            echo "\nRe-run with --apply to create the commissions.\n";
        }

        exit(0);

    // ------------------------------------------------------------------
    case 'reverse':
        $invoiceId = (int) ($options['invoice_id'] ?? 0);

        if ($invoiceId <= 0) {
            fwrite(STDERR, "--invoice_id is required\n");
            exit(1);
        }

        $summary = (new CommissionEngine())->reverseInvoice($invoiceId, 'cli reversal');

        echo "Reversed {$summary['reversed']} commission(s) worth "
            . number_format($summary['amount'], 2) . " for invoice #{$invoiceId}.\n";
        exit(0);

    // ------------------------------------------------------------------
    case 'reset':
        $serviceId = (int) ($options['service_id'] ?? 0);

        if ($serviceId <= 0) {
            fwrite(STDERR, "--service_id is required\n");
            exit(1);
        }

        $updated = Capsule::table(Ledger::TABLE)
            ->where('service_id', $serviceId)
            ->update([
                'first_commission_paid'        => 0,
                'first_commission_reversed_at' => date('Y-m-d H:i:s'),
                'updated_at'                   => date('Y-m-d H:i:s'),
            ]);

        echo "Cleared the first-payment flag on {$updated} ledger row(s) for service #{$serviceId}.\n";
        exit(0);

    // ------------------------------------------------------------------
    default:
        echo <<<TEXT
Custom Affiliate Commission - CLI utility

  status                                   Show configuration and health
  audit [--days=30]                        Check payout/ledger consistency
  report [--from=] [--to=] [--affiliate_id=]  Commission report
  reprocess --invoice_id=N                 Re-run the engine for one invoice
  backfill [--days=30] [--apply]           Evaluate historical paid invoices
  reverse --invoice_id=N                   Reverse every commission on an invoice
  reset --service_id=N                     Clear the first-payment flag

TEXT;
        exit($command === 'help' ? 0 : 1);
}
