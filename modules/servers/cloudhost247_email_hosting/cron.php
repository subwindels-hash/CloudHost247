<?php
/**
 * CloudHost247 Email Hosting - CLI runner.
 *
 * Bounded background work. Safe to run from the system cron alongside the WHMCS
 * cron; a persistent lock prevents overlapping runs.
 *
 *   php cron.php sync        [--batch=25] [--stale=360]   status synchronisation
 *   php cron.php reconcile   [--batch=10]                  uncertain operations
 *   php cron.php service --service_id=N                    one service
 *   php cron.php migrate                                   apply pending migrations
 *   php cron.php status                                    health summary
 *   php cron.php prune       [--days=90]                   log/webhook housekeeping
 *
 * Suggested crontab (every 15 minutes is plenty):
 *   Every 15 minutes:
 *   0,15,30,45 * * * * php /path/to/whmcs/modules/servers/cloudhost247_email_hosting/cron.php sync >/dev/null 2>&1
 *
 * The same work also runs from the WHMCS daily cron through hooks.php, so this
 * file is optional.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    die('This script can only be run from the command line.');
}

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

use CloudHost247\Email\Database\Migrator;
use CloudHost247\Email\Repository\AccountRepository;
use CloudHost247\Email\Service\Reconciler;
use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Support\Result;
use CloudHost247\Email\Webhook\Verifier;
use WHMCS\Database\Capsule;

$command = $argv[1] ?? 'help';
$options = getopt('', ['batch:', 'stale:', 'service_id:', 'days:']);

switch ($command) {
    case 'migrate':
        Migrator::ensureSchema(true);
        $applied = Migrator::runMigrations();

        echo "Schema ensured.\n";
        echo $applied ? ('Applied: ' . implode(', ', $applied) . "\n") : "No pending migrations.\n";

        foreach (Migrator::tableStatus() as $table => $present) {
            echo '  ' . str_pad($table, 34) . ($present ? "ok\n" : "MISSING\n");
        }

        exit(0);

    case 'sync':
        $summary = (new Reconciler())->run(
            (int) ($options['batch'] ?? 25),
            10,
            (int) ($options['stale'] ?? 360)
        );

        foreach ($summary as $key => $value) {
            echo '  ' . str_pad($key, 12) . $value . "\n";
        }

        exit($summary['errors'] > 0 ? 1 : 0);

    case 'reconcile':
        $reconciler = new Reconciler();
        $handled = 0;
        $failed = 0;

        foreach (AccountRepository::needingReconciliation((int) ($options['batch'] ?? 10)) as $account) {
            $result = $reconciler->reconcile((int) $account->service_id);
            $ok = Result::isOk($result);
            $handled += $ok ? 1 : 0;
            $failed += $ok ? 0 : 1;

            printf(
                "  service %-8d %s %s\n",
                (int) $account->service_id,
                $ok ? 'OK ' : 'ERR',
                $ok ? (string) ($result['data']['action'] ?? '') : (string) $result['message']
            );
        }

        echo "Reconciled {$handled}, failed {$failed}.\n";
        exit($failed > 0 ? 1 : 0);

    case 'service':
        $serviceId = (int) ($options['service_id'] ?? 0);

        if ($serviceId <= 0) {
            fwrite(STDERR, "--service_id is required\n");
            exit(1);
        }

        $result = (new Reconciler())->syncService($serviceId);

        echo Result::isOk($result)
            ? "Synchronised service {$serviceId}: " . (string) ($result['data']['action'] ?? 'ok') . "\n"
            : "Failed: " . (string) $result['message'] . "\n";

        exit(Result::isOk($result) ? 0 : 1);

    case 'status':
        Migrator::ensureSchema();

        echo "CloudHost247 Email Hosting " . CH247_EMAIL_VERSION . "\n\n";

        foreach (Migrator::tableStatus() as $table => $present) {
            echo '  ' . str_pad($table, 34) . ($present ? "ok\n" : "MISSING\n");
        }

        try {
            $total = Capsule::table('mod_cloudhost247_email_hosting_accounts')->count();
            $active = Capsule::table('mod_cloudhost247_email_hosting_accounts')->where('status', 'active')->count();
            $reconcile = Capsule::table('mod_cloudhost247_email_hosting_accounts')->where('needs_reconcile', 1)->count();
            $servers = Capsule::table('tblservers')->where('type', 'cloudhost247_email_hosting')->count();
            $products = Capsule::table('tblproducts')->where('servertype', 'cloudhost247_email_hosting')->count();

            echo "\n  servers configured : {$servers}\n";
            echo "  products mapped    : {$products}\n";
            echo "  accounts tracked   : {$total} ({$active} active)\n";
            echo "  awaiting reconcile : {$reconcile}\n";
        } catch (\Throwable $e) {
            echo "\n  (counters unavailable: " . $e->getMessage() . ")\n";
        }

        exit(0);

    case 'prune':
        $days = (int) ($options['days'] ?? 90);
        $logs = Logger::prune($days);
        $hooks = Verifier::prune(min($days, 30));

        echo "Pruned {$logs} log row(s) and {$hooks} webhook receipt(s).\n";
        exit(0);

    default:
        echo <<<TEXT
CloudHost247 Email Hosting CLI

  migrate                                  Create/upgrade the schema
  sync       [--batch=25] [--stale=360]    Bounded status synchronisation
  reconcile  [--batch=10]                  Resolve uncertain operations
  service    --service_id=N                Synchronise one service
  status                                   Health summary
  prune      [--days=90]                   Log and webhook housekeeping

TEXT;
        exit($command === 'help' ? 0 : 1);
}
