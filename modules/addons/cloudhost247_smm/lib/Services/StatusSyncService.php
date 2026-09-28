<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Contracts\ApiRecorder;
use CloudHost247\Smm\Contracts\OrderStore;
use CloudHost247\Smm\Contracts\ProviderFinder;
use CloudHost247\Smm\Support\AdapterException;
use CloudHost247\Smm\Support\StatusMap;
use CloudHost247\Smm\Support\TransportException;

/**
 * Bounded, provider-isolated status synchronization.
 *
 * Rules:
 *  - only orders in state=accepted, not suspended, with a non-terminal (or
 *    unverified) status are polled;
 *  - verified terminal statuses are never overwritten by a later response —
 *    a conflicting observation flags the order for review instead;
 *  - a transport failure marks the provider in error and skips the rest of
 *    that provider's batch (one bad provider cannot stall the queue);
 *  - every transition and every API call is recorded with a correlation id.
 */
final class StatusSyncService
{
    /** Terminal orders are re-verified for this long, then left alone. */
    const TERMINAL_RECHECK_SECONDS = 86400;

    private $finder;
    private $orders;
    private $recorder;
    private $factory;

    public function __construct(ProviderFinder $finder, OrderStore $orders, ApiRecorder $recorder, AdapterFactory $factory)
    {
        $this->finder = $finder;
        $this->orders = $orders;
        $this->recorder = $recorder;
        $this->factory = $factory;
    }

    /**
     * @param int  $limit    batch size (bounded by the repository)
     * @param bool $forceAll skip the "changed only" shortcut (admin action)
     * @return array counters
     */
    public function syncBatch($limit, $forceAll = false)
    {
        $summary = array('checked' => 0, 'updated' => 0, 'conflicts' => 0, 'errors' => 0, 'providers_skipped' => 0);
        $rows = $this->orders->eligibleForStatusSync($limit);
        if (array() === $rows) {
            return $summary;
        }
        $byProvider = array();
        foreach ($rows as $order) {
            $byProvider[(int) $order->provider_id][] = $order;
        }
        foreach ($byProvider as $providerId => $orders) {
            $provider = $this->finder->findProvider($providerId);
            if ($provider === null || (int) $provider->enabled !== 1) {
                continue;
            }
            try {
                $adapter = $this->factory->forProvider($provider);
            } catch (\Throwable $e) {
                $this->finder->markProviderError($providerId, 'Adapter unavailable: ' . $e->getMessage());
                $summary['providers_skipped']++;
                $summary['errors'] += count($orders);
                continue;
            }
            foreach ($orders as $index => $order) {
                $correlationId = OrderService::newCorrelationId();
                $request = array('order' => (string) $order->provider_order_id);
                try {
                    $started = microtime(true);
                    $status = $adapter->orderStatus((string) $order->provider_order_id);
                    $durationMs = (int) round((microtime(true) - $started) * 1000);
                    $this->recorder->record($providerId, 'status', $request, $status, 200, $durationMs, 'success', $correlationId);
                    $summary['checked']++;
                    $this->applyStatus($order, $status, $correlationId, $summary);
                } catch (AdapterException $e) {
                    // e.g. "Incorrect order ID": keep status, flag for review.
                    $this->recorder->record($providerId, 'status', $request,
                        array('error' => $e->rawDetail() !== null ? $e->rawDetail() : $e->getMessage()), 200, 0, 'rejected', $correlationId);
                    $summary['checked']++;
                    $summary['errors']++;
                    $this->orders->updateFields((int) $order->id, array('needs_review' => 1, 'last_sync_at' => date('Y-m-d H:i:s')));
                    $this->orders->recordEvent((int) $order->id, 'status_error', $order->order_status, $order->order_status,
                        'Provider status query refused: ' . $e->getMessage(), 'system', 0, $correlationId);
                } catch (TransportException $e) {
                    $this->recorder->record($providerId, 'status', $request,
                        array('transport_error' => $e->getMessage()), 0, 0, 'error', $correlationId);
                    $this->finder->markProviderError($providerId, $e->getMessage());
                    $summary['providers_skipped']++;
                    $summary['errors'] += count($orders) - $index; // this order + the unpolled remainder
                    break; // provider isolation: stop polling this provider
                }
            }
        }
        return $summary;
    }

    /** Sync a single order now (admin action). Returns the outcome row. */
    public function syncSingle($orderId)
    {
        $order = $this->orders->findById((int) $orderId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'Order not found.');
        }
        $provider = $this->finder->findProvider((int) $order->provider_id);
        if ($provider === null) {
            return array('ok' => false, 'message' => 'Provider no longer exists; history preserved.');
        }
        $correlationId = OrderService::newCorrelationId();
        $request = array('order' => (string) $order->provider_order_id);
        try {
            $adapter = $this->factory->forProvider($provider);
            $started = microtime(true);
            $status = $adapter->orderStatus((string) $order->provider_order_id);
            $durationMs = (int) round((microtime(true) - $started) * 1000);
            $this->recorder->record((int) $provider->id, 'status', $request, $status, 200, $durationMs, 'success', $correlationId);
            $summary = array('checked' => 0, 'updated' => 0, 'conflicts' => 0, 'errors' => 0, 'providers_skipped' => 0);
            $this->applyStatus($order, $status, $correlationId, $summary);
            $this->finder->markProviderSuccess((int) $provider->id);
            return array('ok' => true, 'message' => 'Status fetched: ' . $status['status'] . ($summary['conflicts'] > 0 ? ' (conflict flagged for review)' : ''),
                'correlation_id' => $correlationId);
        } catch (AdapterException $e) {
            return array('ok' => false, 'message' => $e->getMessage(), 'correlation_id' => $correlationId);
        } catch (TransportException $e) {
            $this->recorder->record((int) $provider->id, 'status', $request,
                array('transport_error' => $e->getMessage()), 0, 0, 'error', $correlationId);
            $this->finder->markProviderError((int) $provider->id, $e->getMessage());
            return array('ok' => false, 'message' => $e->getMessage(), 'correlation_id' => $correlationId);
        }
    }

    private function applyStatus($order, array $status, $correlationId, array &$summary)
    {
        $observed = StatusMap::normalize($status['status']);
        $stored = (string) $order->order_status;
        $decision = StatusMap::resolveTransition($stored, $observed);
        $fields = array(
            'provider_status_raw' => mb_substr((string) $status['status'], 0, 64),
            'last_sync_at' => date('Y-m-d H:i:s'),
        );
        if ($status['remains'] !== null) {
            $fields['remains'] = (int) $status['remains'];
        }
        if ($status['start_count'] !== null) {
            $fields['start_count'] = (int) $status['start_count'];
        }
        if ($decision['apply'] !== $stored) {
            $fields['order_status'] = $decision['apply'];
            $fields['last_status_at'] = date('Y-m-d H:i:s');
        }
        if ($decision['conflict']) {
            $fields['needs_review'] = 1;
        }
        $this->orders->updateFields((int) $order->id, $fields);
        if ($decision['conflict']) {
            $summary['conflicts']++;
            $this->orders->recordEvent((int) $order->id, 'status_conflict', $stored, $stored,
                'Provider reported "' . $status['status'] . '" (normalized: ' . $observed . ') but the verified terminal status "' . $stored . '" was kept. Flagged for review.',
                'system', 0, $correlationId);
        } elseif ($decision['apply'] !== $stored) {
            $summary['updated']++;
            $this->orders->recordEvent((int) $order->id, 'status_change', $stored === '' ? null : $stored, $decision['apply'],
                'Provider reported "' . $status['status'] . '".', 'system', 0, $correlationId);
        }
    }
}
