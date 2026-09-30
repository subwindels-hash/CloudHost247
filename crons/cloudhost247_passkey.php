<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }

/**
 * CloudHost247 Passkey housekeeping — standalone cron entry.
 *
 * Recommended schedule (hourly):
 *   php -q /path/to/whmcs/crons/cloudhost247_passkey.php
 *
 * Runs the same work as the AfterCronJob hook: expire stale challenges,
 * release finished lockout windows and apply activity-log retention. All
 * operations are idempotent, so a missed or duplicated run is harmless.
 */

$root = dirname(__DIR__);
require $root . '/init.php';
require_once $root . '/modules/addons/cloudhost247_passkey/cloudhost247_passkey.php';

try {
    $report = cloudhost247_passkey_housekeeping();
    fwrite(STDOUT, 'Passkey housekeeping completed: ' . json_encode($report) . PHP_EOL);
    exit(0);
} catch (\Throwable $e) {
    fwrite(STDERR, 'Passkey housekeeping failed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
