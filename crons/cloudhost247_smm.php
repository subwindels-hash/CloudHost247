<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }

/**
 * CloudHost247 SMM automation — standalone cron entry.
 *
 * Recommended schedule (every five minutes):
 *   php -q /path/to/whmcs/crons/cloudhost247_smm.php
 * Runs the same code as the AfterCronJob hook: status sync, pending
 * submissions, reconciliation (verify-only), catalog sync and cleanup, all
 * bounded and behind the mod_cloudhost247_smm_locks overlap lock.
 */

$root = dirname(__DIR__);
require $root . '/init.php';
require_once $root . '/modules/addons/cloudhost247_smm/bootstrap.php';

try {
    $providers = new \CloudHost247\Smm\Repositories\ProviderRepository();
    $orders = new \CloudHost247\Smm\Repositories\OrderRepository();
    $logs = new \CloudHost247\Smm\Repositories\LogRepository();
    $factory = new \CloudHost247\Smm\Adapters\AdapterFactory();
    $automation = new \CloudHost247\Smm\Services\Automation(
        $orders,
        new \CloudHost247\Smm\Services\OrderService($providers, $orders, $logs, $factory),
        new \CloudHost247\Smm\Services\StatusSyncService($providers, $orders, $logs, $factory),
        new \CloudHost247\Smm\Services\ReconciliationService($providers, $orders, $logs, $factory),
        new \CloudHost247\Smm\Services\SyncService($providers, $logs, $factory)
    );
    $report = $automation->run('cli');
    fwrite(STDOUT, 'SMM automation completed: ' . json_encode($report) . PHP_EOL);
    exit(0);
} catch (\Throwable $e) {
    fwrite(STDERR, 'SMM automation failed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
