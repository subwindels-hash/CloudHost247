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
 * Client-area data and actions. Security invariants:
 *  - every query is scoped by client id — enforced here, not in templates;
 *  - provider names, API URLs, raw responses and internal notes are never
 *    exposed; only customer-meaningful fields are;
 *  - refill/cancel buttons act only on orders that genuinely support them
 *    (provider capability AND catalog flag AND eligible current status);
 *  - error messages carry a correlation id, never provider internals.
 */
final class ClientAreaService
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

    /** Orders for the "My SMM Orders" page — client-scoped, capped at 200. */
    public function ordersForClient($clientId)
    {
        $rows = $this->orders->forClient((int) $clientId);
        $out = array();
        foreach ($rows as $row) {
            $out[] = $this->publicView($row);
        }
        return $out;
    }

    /**
     * Single service view for the provisioning module's client area output.
     * Ownership is enforced: the order must belong to $clientId.
     */
    public function viewForService($whmcsServiceId, $clientId)
    {
        $order = $this->orders->findByWhmcsService((int) $whmcsServiceId, (int) $clientId);
        return $order === null ? null : $this->publicView($order);
    }

    /** Customer-initiated refill. Returns a safe message either way. */
    public function requestRefill($whmcsServiceId, $clientId)
    {
        $order = $this->orders->findByWhmcsService((int) $whmcsServiceId, (int) $clientId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'No order found for this service.');
        }
        return $this->doRefill($order, 'client', (int) $clientId);
    }

    private function doRefill($order, $actor, $actorId)
    {
        $correlationId = OrderService::newCorrelationId();
        if (!$this->refillAllowed($order)) {
            return array('ok' => false, 'message' => 'A refill is not currently available for this order. Reference ' . $correlationId,
                'correlation_id' => $correlationId);
        }
        if ((string) $order->last_refill_id !== '' && !in_array((string) $order->last_refill_status, array('completed', 'canceled', 'rejected', 'failed', ''), true)) {
            return array('ok' => false, 'message' => 'A refill is already in progress for this order.', 'correlation_id' => $correlationId);
        }
        $provider = $this->finder->findProvider((int) $order->provider_id);
        if ($provider === null || (int) $provider->enabled !== 1) {
            return array('ok' => false, 'message' => 'The provider is temporarily unavailable. Please try again later. Reference ' . $correlationId,
                'correlation_id' => $correlationId);
        }
        $request = array('order' => (string) $order->provider_order_id);
        $who = $actor === 'admin' ? 'An administrator' : 'A customer';
        try {
            $adapter = $this->factory->forProvider($provider);
            $started = microtime(true);
            $result = $adapter->requestRefill((string) $order->provider_order_id);
            $durationMs = (int) round((microtime(true) - $started) * 1000);
            $this->recorder->record((int) $provider->id, 'refill', $request, $result, 200, $durationMs, 'success', $correlationId);
            $this->orders->updateFields((int) $order->id, array(
                'last_refill_id' => $result['refill_id'],
                'last_refill_status' => 'requested',
            ));
            $this->orders->recordEvent((int) $order->id, 'refill_requested', $order->order_status, $order->order_status,
                $who . ' requested a refill (provider refill id ' . $result['refill_id'] . ').', $actor, $actorId, $correlationId);
            return array('ok' => true, 'message' => 'Refill requested. The provider will top up the missing amount.', 'correlation_id' => $correlationId);
        } catch (AdapterException $e) {
            $this->recorder->record((int) $provider->id, 'refill', $request,
                array('error' => $e->rawDetail() !== null ? $e->rawDetail() : $e->getMessage()), 200, 0, 'rejected', $correlationId);
            $this->orders->recordEvent((int) $order->id, 'refill_rejected', null, null,
                'Provider refused the refill: ' . $e->getMessage(), $actor, $actorId, $correlationId);
            return array('ok' => false, 'message' => 'The provider could not accept the refill request. Reference ' . $correlationId,
                'correlation_id' => $correlationId);
        } catch (TransportException $e) {
            $this->recorder->record((int) $provider->id, 'refill', $request,
                array('transport_error' => $e->getMessage()), 0, 0, 'error', $correlationId);
            $this->orders->recordEvent((int) $order->id, 'refill_unknown', null, null,
                'Refill request outcome unknown: ' . $e->getMessage(), $actor, $actorId, $correlationId);
            return array('ok' => false, 'message' => 'The refill request could not be delivered. Please contact support with reference ' . $correlationId,
                'correlation_id' => $correlationId);
        }
    }

    /** Customer-initiated cancellation request. */
    public function requestCancel($whmcsServiceId, $clientId)
    {
        $order = $this->orders->findByWhmcsService((int) $whmcsServiceId, (int) $clientId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'No order found for this service.');
        }
        return $this->doCancel($order, 'client', (int) $clientId);
    }

    private function doCancel($order, $actor, $actorId)
    {
        $correlationId = OrderService::newCorrelationId();
        if (!$this->cancelAllowed($order)) {
            return array('ok' => false, 'message' => 'This order can no longer be canceled. Reference ' . $correlationId,
                'correlation_id' => $correlationId);
        }
        $provider = $this->finder->findProvider((int) $order->provider_id);
        if ($provider === null || (int) $provider->enabled !== 1) {
            return array('ok' => false, 'message' => 'The provider is temporarily unavailable. Please try again later. Reference ' . $correlationId,
                'correlation_id' => $correlationId);
        }
        $request = array('order' => (string) $order->provider_order_id);
        $who = $actor === 'admin' ? 'An administrator' : 'A customer';
        try {
            $adapter = $this->factory->forProvider($provider);
            $started = microtime(true);
            $result = $adapter->requestCancel((string) $order->provider_order_id);
            $durationMs = (int) round((microtime(true) - $started) * 1000);
            $this->recorder->record((int) $provider->id, 'cancel', $request, $result, 200, $durationMs, 'success', $correlationId);
            $this->orders->updateFields((int) $order->id, array(
                'order_status' => StatusMap::CANCELED,
                'provider_status_raw' => 'cancel requested by ' . $actor,
                'last_status_at' => date('Y-m-d H:i:s'),
            ));
            $this->orders->recordEvent((int) $order->id, 'cancel_requested', $order->order_status, StatusMap::CANCELED,
                $who . ' requested cancellation; the provider accepted the request.', $actor, $actorId, $correlationId);
            return array('ok' => true, 'message' => 'Cancellation requested. The provider will stop the order.', 'correlation_id' => $correlationId);
        } catch (AdapterException $e) {
            $this->recorder->record((int) $provider->id, 'cancel', $request,
                array('error' => $e->rawDetail() !== null ? $e->rawDetail() : $e->getMessage()), 200, 0, 'rejected', $correlationId);
            $this->orders->recordEvent((int) $order->id, 'cancel_rejected', null, null,
                'Provider refused cancellation: ' . $e->getMessage(), $actor, $actorId, $correlationId);
            return array('ok' => false, 'message' => 'The provider could not cancel this order (it may already be in progress). Reference ' . $correlationId,
                'correlation_id' => $correlationId);
        } catch (TransportException $e) {
            $this->recorder->record((int) $provider->id, 'cancel', $request,
                array('transport_error' => $e->getMessage()), 0, 0, 'error', $correlationId);
            $this->orders->recordEvent((int) $order->id, 'cancel_unknown', null, null,
                'Cancel request outcome unknown: ' . $e->getMessage(), $actor, $actorId, $correlationId);
            return array('ok' => false, 'message' => 'The cancellation request could not be delivered. Please contact support with reference ' . $correlationId,
                'correlation_id' => $correlationId);
        }
    }

    /** Admin-triggered refill from the SMM admin area. */
    public function requestRefillById($orderId, $adminId)
    {
        $order = $this->orders->findById((int) $orderId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'Order not found.');
        }
        return $this->doRefill($order, 'admin', (int) $adminId);
    }

    /** Admin-triggered cancellation from the SMM admin area. */
    public function requestCancelById($orderId, $adminId)
    {
        $order = $this->orders->findById((int) $orderId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'Order not found.');
        }
        return $this->doCancel($order, 'admin', (int) $adminId);
    }

    // --------------------------------------------------------------- helpers

    public function refillAllowed($order)
    {
        return (int) $order->refill_supported === 1
            && in_array((string) $order->order_status, array(StatusMap::COMPLETED, StatusMap::PARTIAL), true);
    }

    public function cancelAllowed($order)
    {
        return (int) $order->cancel_supported === 1
            && in_array((string) $order->order_status, array(StatusMap::PENDING, StatusMap::PROCESSING, StatusMap::IN_PROGRESS), true);
    }

    /** Whitelist of customer-visible fields. Provider/API internals are stripped. */
    private function publicView($row)
    {
        $view = array(
            'id' => (int) $row->id,
            'service_name' => (string) $row->service_name,
            'status' => (string) $row->order_status,
            'status_label' => StatusMap::customerLabel((string) $row->order_status),
            'submission_state' => (string) $row->submission_state,
            'target_url' => (string) $row->target_url,
            'quantity' => (int) $row->quantity,
            'start_count' => $row->start_count !== null ? (int) $row->start_count : null,
            'remains' => $row->remains !== null ? (int) $row->remains : null,
            'created_at' => (string) $row->created_at,
            'last_status_at' => $row->last_status_at !== null ? (string) $row->last_status_at : null,
            'refill_allowed' => $this->refillAllowed($row),
            'cancel_allowed' => $this->cancelAllowed($row),
        );
        if ((string) $row->submission_state === OrderService::STATE_REJECTED) {
            $view['status_label'] = 'Processing issue — contact support';
            $view['status'] = 'failed';
        } elseif ((string) $row->submission_state === OrderService::STATE_UNCERTAIN) {
            $view['status_label'] = 'Processing — verifying with provider';
        } elseif ((string) $row->submission_state === OrderService::STATE_AWAITING
            || (string) $row->submission_state === OrderService::STATE_IN_FLIGHT) {
            $view['status_label'] = 'Queued';
        } elseif ((string) $row->submission_state === OrderService::STATE_TERMINATED) {
            $view['status_label'] = StatusMap::customerLabel((string) $row->order_status) !== 'Not verified'
                ? StatusMap::customerLabel((string) $row->order_status) . ' (service ended)' : 'Service ended';
        }
        return $view;
    }
}
