<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Foundation\Support\Logger;
use CloudHost247\Smm\Contracts\OrderStore;

/**
 * Cron/automation orchestrator. Runs bounded tasks behind a database lock so
 * overlapping cron processes cannot double-execute. Intervals are enforced
 * with persisted last-run timestamps; nothing is retried blindly.
 */
final class Automation
{
    const LOCK_NAME = 'smm_automation';

    private $orders;
    private $orderService;
    private $statusSync;
    private $reconciliation;
    private $catalogSync;

    public function __construct(OrderStore $orders, OrderService $orderService, StatusSyncService $statusSync, ReconciliationService $reconciliation, SyncService $catalogSync)
    {
        $this->orders = $orders;
        $this->orderService = $orderService;
        $this->statusSync = $statusSync;
        $this->reconciliation = $reconciliation;
        $this->catalogSync = $catalogSync;
    }

    /**
     * @param string $trigger cron|cli
     * @return array run report
     */
    public function run($trigger = 'cron')
    {
        $report = array('ran' => false, 'reason' => '', 'tasks' => array());
        $settings = Settings::all();
        if ((int) $settings['automation_enabled'] !== 1) {
            $report['reason'] = 'Automation disabled in settings.';
            return $report;
        }
        $lock = new ExecutionLock(self::LOCK_NAME);
        if (!$lock->acquire((int) $settings['cron_lock_minutes'])) {
            $report['reason'] = 'Another automation run holds the lock.';
            return $report;
        }
        try {
            $report['ran'] = true;

            // 1. Status sync
            if ($this->isDue(Settings::getRuntime('last_status_sync_at'), 60 * (int) $settings['status_sync_minutes'])) {
                $summary = $this->statusSync->syncBatch((int) $settings['order_batch_size']);
                $report['tasks']['status_sync'] = $summary;
                Settings::saveRuntime('last_status_sync_at', date('Y-m-d H:i:s'));
                $this->log('status sync', $summary);
            }

            // 2. Pending/awaiting submissions + crashed in-flight sweeps
            $this->drivePendingSubmissions($settings, $report);
            $this->sweepStaleInFlight($settings);

            // 3. Reconciliation (verify-only, never resubmits)
            if ($this->isDue(Settings::getRuntime('last_reconciliation_at'), 60 * (int) $settings['reconcile_minutes'])) {
                $summary = $this->reconciliation->process((int) $settings['reconcile_batch_size']);
                $report['tasks']['reconciliation'] = $summary;
                Settings::saveRuntime('last_reconciliation_at', date('Y-m-d H:i:s'));
                $this->log('reconciliation', $summary);
            }

            // 4. Scheduled catalog sync
            if ($this->isDue(Settings::getRuntime('last_catalog_sync_at'), 3600 * (int) $settings['catalog_sync_hours'])) {
                $results = $this->catalogSync->syncAllEnabled($trigger);
                $report['tasks']['catalog_sync'] = array_map(function ($r) {
                    return array('ok' => $r['ok'], 'message' => $r['message']);
                }, $results);
                Settings::saveRuntime('last_catalog_sync_at', date('Y-m-d H:i:s'));
                $this->log('catalog sync', $report['tasks']['catalog_sync']);
            }

            // 5. Cleanup (cheap, indexed)
            ExecutionLock::purgeStale();
            $purged = (new \CloudHost247\Smm\Repositories\LogRepository())
                ->purgeOlderThanDays((int) $settings['api_log_retention_days']);
            if ($purged > 0) {
                $report['tasks']['cleanup'] = array('api_log_rows_deleted' => $purged);
            }
        } catch (\Throwable $e) {
            // Automation must never take WHMCS down with it.
            $report['tasks']['fatal'] = array('message' => $e->getMessage());
            Logger::write('cloudhost247_smm', 'error', 'automation.fatal', array(
                'message' => $e->getMessage(),
                'file' => basename($e->getFile()),
                'line' => $e->getLine(),
            ));
        } finally {
            $lock->release();
        }
        return $report;
    }

    /** Submit awaiting orders (they were queued by CreateAccount races/failures). */
    private function drivePendingSubmissions(array $settings, array &$report)
    {
        $awaiting = $this->orders->findByState(OrderService::STATE_AWAITING, (int) $settings['order_batch_size']);
        if (array() === $awaiting) {
            return;
        }
        $outcomes = array('submitted' => 0, 'rejected' => 0, 'uncertain' => 0, 'other' => 0);
        foreach ($awaiting as $order) {
            $result = $this->orderService->submitForService(array(
                'whmcs_service_id' => (int) $order->whmcs_service_id,
                'whmcs_order_id' => (int) $order->whmcs_order_id,
                'whmcs_client_id' => (int) $order->whmcs_client_id,
                'whmcs_product_id' => (int) $order->whmcs_product_id,
                'target_url' => (string) $order->target_url,
                'quantity' => (int) $order->quantity,
            ));
            if (isset($result['state'])) {
                if ($result['state'] === OrderService::STATE_ACCEPTED) { $outcomes['submitted']++; }
                elseif ($result['state'] === OrderService::STATE_REJECTED) { $outcomes['rejected']++; }
                elseif ($result['state'] === OrderService::STATE_UNCERTAIN) { $outcomes['uncertain']++; }
                else { $outcomes['other']++; }
            }
        }
        $report['tasks']['pending_submissions'] = $outcomes;
    }

    /**
     * Orders stuck in in_flight: the worker died mid-submission, so the
     * outcome is UNKNOWN — mark uncertain for reconciliation, never resend.
     */
    private function sweepStaleInFlight(array $settings)
    {
        $cutoff = date('Y-m-d H:i:s', time() - 900); // 15 minutes in flight = crashed
        $stale = $this->orders->staleInFlight($cutoff, (int) $settings['reconcile_batch_size']);
        foreach ($stale as $order) {
            $correlationId = OrderService::newCorrelationId();
            $this->orders->markUncertain((int) $order->id, 'Submission worker did not finish; outcome unknown.');
            $this->orders->recordEvent((int) $order->id, 'reconciliation_required', null, null,
                'Submission worker did not finish; the order is queued for reconciliation.', 'system', 0, $correlationId);
        }
        if (count($stale) > 0) {
            Logger::write('cloudhost247_smm', 'warning', 'automation.stale_inflight', array('count' => count($stale)));
        }
    }

    /**
     * Pure interval check (unit tested).
     * @param string|null $lastRunIso
     * @param int         $intervalSeconds
     * @param int|null    $nowTs
     * @return bool
     */
    public static function isDue($lastRunIso, $intervalSeconds, $nowTs = null)
    {
        $intervalSeconds = (int) $intervalSeconds;
        if ($intervalSeconds < 60) {
            $intervalSeconds = 60; // floors runaway settings; per-minute is the finest cadence
        }
        $nowTs = $nowTs === null ? time() : (int) $nowTs;
        if ($lastRunIso === null || $lastRunIso === '' || trim((string) $lastRunIso) === '') {
            return true;
        }
        $ts = strtotime((string) $lastRunIso);
        if ($ts === false) {
            return true;
        }
        return ($nowTs - $ts) >= $intervalSeconds;
    }

    private function log($task, array $context)
    {
        Logger::write('cloudhost247_smm', 'info', 'automation.' . $task, $context);
    }
}
