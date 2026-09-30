<?php
/**
 * CloudHost247 Cart Recovery worker.
 *
 * Run from cron (see README). It bootstraps WHMCS, takes the database lock,
 * promotes inactive carts to abandoned, sends only reminders that are due
 * and eligible, records every result, advances the schedule and expires
 * stale records — all in bounded batches.
 *
 *   Example (every five minutes, deployment-specific paths):
 *   [*]/5 * * * * /usr/local/bin/php /home/<user>/public_html/whmcs/modules/addons/cloudhost247_cart_recovery/cron.php
 *   (replace [*] with an asterisk; see README.md for the exact command)
 */

if (PHP_SAPI !== 'cli') {
    // Never reachable over HTTP: reminder processing is a CLI/cron task.
    http_response_code(403);
    exit("This worker may only be executed from the command line.\n");
}

$whmcsRoot = dirname(dirname(dirname(__DIR__)));
if (!is_file($whmcsRoot . '/init.php')) {
    fwrite(STDERR, "Unable to locate the WHMCS init.php relative to this addon.\n");
    exit(2);
}
require_once $whmcsRoot . '/init.php';
require_once __DIR__ . '/bootstrap.php';

use CloudHost247\CartRecovery\Lock;
use CloudHost247\CartRecovery\Log;
use CloudHost247\CartRecovery\MigrationRunner;
use CloudHost247\CartRecovery\ReminderService;
use CloudHost247\CartRecovery\SettingsRepository;

$started = microtime(true);
$exitCode = 0;

try {
    if (!SettingsRepository::enabled('enabled')) {
        fwrite(STDOUT, "Cart recovery is disabled; nothing to do.\n");
        exit(0);
    }
    // Guarded, idempotent: only applies migrations that have not run yet.
    MigrationRunner::migrate();

    if (!Lock::acquire('cron')) {
        fwrite(STDOUT, "Another cart-recovery worker holds the lock; exiting.\n");
        exit(0);
    }

    Log::info('cron.started', array());
    try {
        $result = ReminderService::process();
    } finally {
        Lock::release('cron');
    }

    $result['duration_ms'] = (int) round((microtime(true) - $started) * 1000);
    Log::info('cron.completed', $result);
    fwrite(STDOUT, json_encode($result) . "\n");
} catch (\Throwable $e) {
    $exitCode = 1;
    Log::error('cron.failed', array('error' => Log::safeError($e)));
    fwrite(STDERR, "Cart recovery worker failed; see the module log.\n");
}

exit($exitCode);
