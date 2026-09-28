<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Contracts\ApiRecorder;
use CloudHost247\Smm\Contracts\OrderStore;
use CloudHost247\Smm\Contracts\ProviderFinder;
use CloudHost247\Smm\Support\AdapterException;
use CloudHost247\Smm\Support\TransportException;

/**
 * Reconciliation of orders whose submission outcome is unknown
 * (submission_state = uncertain).
 *
 * Policy: reconciliation VERIFIES, it never resubmits. An uncertain order
 * with a provider order id attached by an administrator is polled; if the
 * provider knows the order it becomes accepted, otherwise it stays flagged
 * for manual attention. Orders without a provider order id need a human to
 * check the provider panel — the module reports them and does nothing else.
 */
final class ReconciliationService
{
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
     * @param int $limit bounded batch
     * @return array counters + the ids that still need manual attention
     */
    public function process($limit)
    {
        $summary = array(
            'examined' => 0,
            'resolved' => 0,
            'needs_manual_attention' => 0,
            'errors' => 0,
            'attention_ids' => array(),
        );
        $rows = $this->orders->findByState(OrderService::STATE_UNCERTAIN, $limit);
        foreach ($rows as $order) {
            $summary['examined']++;
            $correlationId = OrderService::newCorrelationId();
            if ((string) $order->provider_order_id === '') {
                // Outcome unknown AND nothing to verify against: human required.
                $summary['needs_manual_attention']++;
                $summary['attention_ids'][] = (int) $order->id;
                continue;
            }
            $provider = $this->finder->findProvider((int) $order->provider_id);
            if ($provider === null) {
                $summary['needs_manual_attention']++;
                $summary['attention_ids'][] = (int) $order->id;
                continue;
            }
            $request = array('order' => (string) $order->provider_order_id);
            try {
                $adapter = $this->factory->forProvider($provider);
                $started = microtime(true);
                $status = $adapter->orderStatus((string) $order->provider_order_id);
                $durationMs = (int) round((microtime(true) - $started) * 1000);
                $this->recorder->record((int) $provider->id, 'status', $request, $status, 200, $durationMs, 'success', $correlationId);
                // The provider knows the order: submission succeeded after all.
                $this->orders->updateFields((int) $order->id, array(
                    'submission_state' => OrderService::STATE_ACCEPTED,
                    'error_message' => '',
                    'submitted_at' => $order->submitted_at !== null && (string) $order->submitted_at !== ''
                        ? (string) $order->submitted_at : date('Y-m-d H:i:s'),
                ));
                $this->orders->recordEvent((int) $order->id, 'reconciled', null, null,
                    'Reconciliation confirmed the provider accepted this order (provider order id ' . $order->provider_order_id . ').',
                    'system', 0, $correlationId);
                $summary['resolved']++;
            } catch (AdapterException $e) {
                // Provider says it does not know the order — definitive: it
                // was NOT created. Safe to mark rejected and allow a retry.
                $this->recorder->record((int) $provider->id, 'status', $request,
                    array('error' => $e->rawDetail() !== null ? $e->rawDetail() : $e->getMessage()), 200, 0, 'rejected', $correlationId);
                $this->orders->updateFields((int) $order->id, array(
                    'submission_state' => OrderService::STATE_REJECTED,
                    'error_message' => 'Reconciliation: the provider does not know this order. ' . $e->getMessage(),
                ));
                $this->orders->recordEvent((int) $order->id, 'reconciled_rejected', null, null,
                    'Reconciliation: the provider does not know this order, so it was never created. Retry is safe.',
                    'system', 0, $correlationId);
                $summary['resolved']++;
            } catch (TransportException $e) {
                $this->recorder->record((int) $provider->id, 'status', $request,
                    array('transport_error' => $e->getMessage()), 0, 0, 'error', $correlationId);
                $this->finder->markProviderError((int) $provider->id, $e->getMessage());
                $summary['errors']++;
            }
        }
        return $summary;
    }
}
