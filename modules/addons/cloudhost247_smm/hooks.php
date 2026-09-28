<?php
if (!defined('WHMCS')) { die('Direct access denied'); }
require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Foundation\Support\Logger;
use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Repositories\LogRepository;
use CloudHost247\Smm\Repositories\OrderRepository;
use CloudHost247\Smm\Repositories\ProviderRepository;
use CloudHost247\Smm\Services\Automation;
use CloudHost247\Smm\Services\OrderService;
use CloudHost247\Smm\Services\ReconciliationService;
use CloudHost247\Smm\Services\StatusSyncService;
use CloudHost247\Smm\Services\SyncService;

/**
 * Automation piggybacks on the WHMCS cron (AfterCronJob). Task intervals,
 * overlap locking and batch bounds are enforced inside Automation::run();
 * the crons/cloudhost247_smm.php CLI entry runs the exact same code.
 */
add_hook('AfterCronJob', 1, function () {
    try {
        $providers = new ProviderRepository();
        $orders = new OrderRepository();
        $logs = new LogRepository();
        $factory = new AdapterFactory();
        $automation = new Automation(
            $orders,
            new OrderService($providers, $orders, $logs, $factory),
            new StatusSyncService($providers, $orders, $logs, $factory),
            new ReconciliationService($providers, $orders, $logs, $factory),
            new SyncService($providers, $logs, $factory)
        );
        $report = $automation->run('cron');
        if (!empty($report['tasks'])) {
            Logger::write('cloudhost247_smm', 'info', 'cron.finished', array('tasks' => array_keys($report['tasks'])));
        }
    } catch (\Throwable $e) {
        // A failing automation run must never break the WHMCS cron.
        Logger::write('cloudhost247_smm', 'error', 'cron.failed', array(
            'message' => $e->getMessage(),
            'file' => basename($e->getFile()),
            'line' => $e->getLine(),
        ));
    }
});
