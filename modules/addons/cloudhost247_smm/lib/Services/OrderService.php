<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Contracts\ApiRecorder;
use CloudHost247\Smm\Contracts\OrderStore;
use CloudHost247\Smm\Contracts\ProviderFinder;
use CloudHost247\Smm\Support\AdapterException;
use CloudHost247\Smm\Support\StatusMap;
use CloudHost247\Smm\Support\TransportException;
use CloudHost247\Smm\Support\Validator;
use RuntimeException;

/**
 * Order submission engine.
 *
 * Guarantees:
 *  - an order is only submitted after WHMCS payment + provisioning approval
 *    (the only caller is the provisioning module's CreateAccount);
 *  - exactly one submission per WHMCS service: unique index on
 *    whmcs_service_id plus an optimistic claim (awaiting -> in_flight);
 *  - repeated CreateAccount calls, cron runs or page refreshes return the
 *    recorded outcome instead of re-submitting;
 *  - a lost/unreadable response is marked for reconciliation — never a blind
 *    resubmit (which would double-charge the customer);
 *  - provider rejections are surfaced verbatim (provider-authored text is
 *    customer-safe) and stored for retry-after-correction.
 */
final class OrderService
{
    const STATE_AWAITING = 'awaiting_submission';
    const STATE_IN_FLIGHT = 'in_flight';
    const STATE_ACCEPTED = 'accepted';
    const STATE_REJECTED = 'rejected';
    const STATE_UNCERTAIN = 'uncertain'; // == reconciliation required
    const STATE_TERMINATED = 'terminated';

    private $finder;
    private $orders;
    private $recorder;
    private $factory;
    private $linkValidator;

    /**
     * @param callable|null $linkValidator optional seam for validating a customer target link.
     *        Production omits it, and the SSRF-checked `Validator::targetLink()` (public-host
     *        resolution, scheme and credential rules) is used unchanged. It exists so tests can
     *        supply a resolver with deterministic DNS: `UrlPolicy::resolveHost()` performs a live
     *        `gethostbynamel()`, so without this seam every submission test would depend on the
     *        machine's DNS answers and would fail on any host whose resolver answers private
     *        addresses for public names — reporting a security refusal as a test failure and
     *        hiding real regressions behind an environmental one.
     */
    public function __construct(ProviderFinder $finder, OrderStore $orders, ApiRecorder $recorder, AdapterFactory $factory, $linkValidator = null)
    {
        $this->finder = $finder;
        $this->orders = $orders;
        $this->recorder = $recorder;
        $this->factory = $factory;
        $this->linkValidator = is_callable($linkValidator) ? $linkValidator : null;
    }

    /**
     * Submit (or report the existing outcome of) a WHMCS service's order.
     *
     * @param array $input keys: whmcs_service_id, whmcs_order_id, whmcs_client_id,
     *                     whmcs_product_id, target_url, quantity
     * @return array array('ok' => bool, 'message' => string, 'detail' => string,
     *                     'state' => string, 'provider_order_id' => string|null,
     *                     'correlation_id' => string)
     */
    public function submitForService(array $input)
    {
        $correlationId = self::newCorrelationId();
        $serviceId = (int) (isset($input['whmcs_service_id']) ? $input['whmcs_service_id'] : 0);
        $productId = (int) (isset($input['whmcs_product_id']) ? $input['whmcs_product_id'] : 0);
        $clientId = (int) (isset($input['whmcs_client_id']) ? $input['whmcs_client_id'] : 0);

        if ($serviceId <= 0 || $productId <= 0 || $clientId <= 0) {
            return $this->fail('The order could not be prepared: missing service, product or client reference.', $correlationId);
        }

        // Idempotency gate: an existing record for this WHMCS service is
        // authoritative. Only a still-awaiting order may re-enter submission.
        $existing = $this->orders->findByServiceId($serviceId);
        if ($existing !== null && (string) $existing->submission_state !== self::STATE_AWAITING) {
            return $this->existingOutcome($existing, $correlationId);
        }

        if ($existing !== null) {
            // Awaiting (first attempt raced, or an admin re-queued a rejection):
            // resume from the stored mapping snapshot, never invent a new one.
            $mapping = $this->finder->mappingById((int) $existing->mapping_id);
            $orderId = (int) $existing->id;
        } else {
            $mapping = $this->finder->activeMappingByProduct($productId);
            $orderId = 0;
        }
        if ($mapping === null) {
            return $this->fail('This product is not mapped to a provider service yet. Please contact support.', $correlationId);
        }
        $provider = $this->finder->findProvider((int) $mapping->provider_id);
        $service = $this->finder->findService((int) $mapping->service_id);
        if ($provider === null || (int) $provider->enabled !== 1) {
            return $this->fail('The provider for this service is currently unavailable. Your order is queued with support.', $correlationId);
        }
        if ($service === null || (int) $service->available !== 1) {
            return $this->fail('The provider service is temporarily unavailable. Your order is queued with support.', $correlationId);
        }

        try {
            $link = $this->linkValidator !== null
                ? call_user_func($this->linkValidator, isset($input['target_url']) ? $input['target_url'] : '')
                : Validator::targetLink(isset($input['target_url']) ? $input['target_url'] : '');
            $quantity = Validator::quantity(
                isset($input['quantity']) ? $input['quantity'] : 0,
                $mapping->min_quantity !== null ? (int) $mapping->min_quantity : ($service->min_quantity !== null ? (int) $service->min_quantity : null),
                $mapping->max_quantity !== null ? (int) $mapping->max_quantity : ($service->max_quantity !== null ? (int) $service->max_quantity : null)
            );
        } catch (RuntimeException $e) {
            return $this->fail($e->getMessage(), $correlationId);
        }

        if ($orderId === 0) {
            $orderId = $this->orders->create(array(
                'whmcs_service_id' => $serviceId,
                'whmcs_order_id' => (int) (isset($input['whmcs_order_id']) ? $input['whmcs_order_id'] : 0),
                'whmcs_client_id' => $clientId,
                'whmcs_product_id' => $productId,
                'mapping_id' => (int) $mapping->id,
                'provider_id' => (int) $provider->id,
                'provider_service_id' => (string) $mapping->provider_service_id,
                'provider_name' => (string) $provider->name,
                'service_name' => (string) $mapping->name,
                'target_url' => $link,
                'quantity' => $quantity,
                'customer_price' => $mapping->sell_price !== null ? (float) $mapping->sell_price : null,
                'provider_cost' => $service->rate !== null ? (float) $service->rate : null,
                'currency' => (string) ($mapping->currency !== '' ? $mapping->currency : $service->currency),
                'submission_state' => self::STATE_AWAITING,
                'order_status' => null,
                'provider_status_raw' => '',
                'refill_supported' => (int) (((int) $provider->refill_supported === 1 && (int) $service->refill === 1) ? 1 : 0),
                'cancel_supported' => (int) (((int) $provider->cancel_supported === 1 && (int) $service->cancel === 1) ? 1 : 0),
                'correlation_id' => $correlationId,
                'error_message' => '',
            ));
        } else {
            // Resume: refresh the validated inputs on the stored row.
            $this->orders->updateFields($orderId, array(
                'target_url' => $link,
                'quantity' => $quantity,
                'error_message' => '',
            ));
        }

        if (!$this->orders->claimForSubmission($orderId)) {
            // Another process owns the submission: stand down, never race it.
            return array(
                'ok' => true, // do not fail provisioning; the other submitter owns it
                'message' => 'Order submission is already in progress.',
                'detail' => 'Claimed by another worker.',
                'state' => self::STATE_IN_FLIGHT,
                'provider_order_id' => null,
                'correlation_id' => $correlationId,
            );
        }

        return $this->sendToProvider($orderId, $provider, $mapping, $service, $link, $quantity, $correlationId);
    }

    /**
     * Admin-forced retry after a definitive rejection. Only allowed when no
     * provider order id is recorded — that keeps the retry idempotent.
     */
    public function retrySubmission($orderId, $adminId)
    {
        $correlationId = self::newCorrelationId();
        $order = $this->orders->findById((int) $orderId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'Order not found.', 'correlation_id' => $correlationId);
        }
        if ((string) $order->submission_state !== self::STATE_REJECTED) {
            return array('ok' => false, 'message' => 'Only rejected orders can be retried.', 'correlation_id' => $correlationId);
        }
        if ((string) $order->provider_order_id !== '') {
            return array('ok' => false, 'message' => 'A provider order id is already recorded; resubmission is blocked.', 'correlation_id' => $correlationId);
        }
        $this->orders->updateFields((int) $order->id, array(
            'submission_state' => self::STATE_AWAITING,
            'error_message' => '',
        ));
        $this->orders->recordEvent((int) $order->id, 'retry_queued', null, null,
            'Administrator re-queued a rejected order for submission.', 'admin', (int) $adminId, $correlationId);
        return $this->submitForService(array(
            'whmcs_service_id' => (int) $order->whmcs_service_id,
            'whmcs_order_id' => (int) $order->whmcs_order_id,
            'whmcs_client_id' => (int) $order->whmcs_client_id,
            'whmcs_product_id' => (int) $order->whmcs_product_id,
            'target_url' => (string) $order->target_url,
            'quantity' => (int) $order->quantity,
        ));
    }

    /** Attach a provider order id found manually during reconciliation. */
    public function attachProviderOrder($orderId, $providerOrderId, $adminId)
    {
        $correlationId = self::newCorrelationId();
        $providerOrderId = trim((string) $providerOrderId);
        if ($providerOrderId === '' || strlen($providerOrderId) > 64) {
            return array('ok' => false, 'message' => 'A provider order id (max 64 characters) is required.', 'correlation_id' => $correlationId);
        }
        $order = $this->orders->findById((int) $orderId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'Order not found.', 'correlation_id' => $correlationId);
        }
        if ((string) $order->provider_order_id !== '' && (string) $order->provider_order_id !== $providerOrderId) {
            return array('ok' => false, 'message' => 'A different provider order id is already recorded. Resolve manually.', 'correlation_id' => $correlationId);
        }
        $this->orders->attachProviderOrderId((int) $orderId, $providerOrderId);
        $this->orders->recordEvent((int) $orderId, 'reconcile_attach', $order->order_status, $order->order_status,
            'Provider order id attached during reconciliation: ' . $providerOrderId, 'admin', (int) $adminId, $correlationId);
        return array('ok' => true, 'message' => 'Provider order id attached. Status will verify on the next sync.',
            'correlation_id' => $correlationId);
    }

    /**
     * Mark a WHMCS service as terminated locally. Never cancels at the
     * provider silently — the administrator decides that explicitly.
     */
    public function markTerminated($whmcsServiceId, $note, $actor, $actorId)
    {
        $correlationId = self::newCorrelationId();
        $order = $this->orders->findByServiceId((int) $whmcsServiceId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'No SMM order exists for this service.', 'correlation_id' => $correlationId);
        }
        $this->orders->updateFields((int) $order->id, array('submission_state' => self::STATE_TERMINATED));
        $this->orders->recordEvent((int) $order->id, 'terminated', $order->order_status, $order->order_status,
            $note, $actor, (int) $actorId, $correlationId);
        return array('ok' => true, 'message' => 'Order marked terminated locally. Provider history preserved.',
            'correlation_id' => $correlationId);
    }

    public function setSuspended($whmcsServiceId, $suspended, $actor, $actorId)
    {
        $correlationId = self::newCorrelationId();
        $order = $this->orders->findByServiceId((int) $whmcsServiceId);
        if ($order === null) {
            return array('ok' => false, 'message' => 'No SMM order exists for this service.', 'correlation_id' => $correlationId);
        }
        $this->orders->updateFields((int) $order->id, array('suspended' => $suspended ? 1 : 0));
        $this->orders->recordEvent((int) $order->id, $suspended ? 'suspended' : 'unsuspended', null, null,
            $suspended ? 'Status sync paused while the service is suspended.' : 'Status sync resumed.',
            $actor, (int) $actorId, $correlationId);
        return array('ok' => true, 'message' => $suspended ? 'Status sync paused.' : 'Status sync resumed.',
            'correlation_id' => $correlationId);
    }

    public static function newCorrelationId()
    {
        return bin2hex(random_bytes(10));
    }

    // ------------------------------------------------------------------ core

    private function sendToProvider($orderId, $provider, $mapping, $service, $link, $quantity, $correlationId)
    {
        $request = array(
            'service' => (string) $mapping->provider_service_id,
            'link' => $link,
            'quantity' => (string) $quantity,
        );
        try {
            $adapter = $this->factory->forProvider($provider);
            $started = microtime(true);
            $result = $adapter->submitOrder((string) $mapping->provider_service_id, $link, $quantity);
            $durationMs = (int) round((microtime(true) - $started) * 1000);
            $this->recorder->record((int) $provider->id, 'add', $request, $result['raw'], 200, $durationMs, 'success', $correlationId);
            $this->orders->markAccepted($orderId, $result['provider_order_id'], array(
                'order_status' => StatusMap::PENDING,
                'provider_status_raw' => 'submitted',
                'last_status_at' => date('Y-m-d H:i:s'),
            ));
            $this->orders->recordEvent($orderId, 'submitted', null, StatusMap::PENDING,
                'Provider accepted the order (provider order id ' . $result['provider_order_id'] . ').',
                'system', 0, $correlationId);
            $this->finder->markProviderSuccess((int) $provider->id);
            return array(
                'ok' => true,
                'message' => 'Order submitted to the provider.',
                'detail' => 'Provider order id: ' . $result['provider_order_id'],
                'state' => self::STATE_ACCEPTED,
                'provider_order_id' => $result['provider_order_id'],
                'correlation_id' => $correlationId,
            );
        } catch (AdapterException $e) {
            // Definitive refusal — safe to store and surface.
            $this->recorder->record((int) $provider->id, 'add', $request,
                array('error' => $e->rawDetail() !== null ? $e->rawDetail() : $e->getMessage()), 200, 0, 'rejected', $correlationId);
            $this->orders->markRejected($orderId, $e->getMessage());
            $this->orders->recordEvent($orderId, 'rejected', null, null, $e->getMessage(), 'system', 0, $correlationId);
            return array(
                'ok' => false,
                'message' => $e->getMessage(),
                'detail' => 'The provider refused the order. Correct the configuration and retry.',
                'state' => self::STATE_REJECTED,
                'provider_order_id' => null,
                'correlation_id' => $correlationId,
            );
        } catch (TransportException $e) {
            // Unknown outcome — MUST NOT resubmit automatically.
            $this->recorder->record((int) $provider->id, 'add', $request,
                array('transport_error' => $e->getMessage()), 0, 0, 'error', $correlationId);
            $this->orders->markUncertain($orderId, $e->getMessage());
            $this->orders->recordEvent($orderId, 'reconciliation_required', null, null,
                'Submission outcome unknown: ' . $e->getMessage(), 'system', 0, $correlationId);
            $this->finder->markProviderError((int) $provider->id, $e->getMessage());
            return array(
                'ok' => false,
                'message' => 'The provider connection failed. The order has been queued for reconciliation — reference ' . $correlationId,
                'detail' => 'Outcome unknown; automatic resubmission is disabled to prevent double orders.',
                'state' => self::STATE_UNCERTAIN,
                'provider_order_id' => null,
                'correlation_id' => $correlationId,
            );
        } catch (RuntimeException $e) {
            // Misconfiguration (e.g. key unreadable) — deterministic: treat as rejected.
            $this->orders->markRejected($orderId, $e->getMessage());
            $this->orders->recordEvent($orderId, 'rejected', null, null, $e->getMessage(), 'system', 0, $correlationId);
            return array(
                'ok' => false,
                'message' => 'Provider configuration error. Reference ' . $correlationId,
                'detail' => $e->getMessage(),
                'state' => self::STATE_REJECTED,
                'provider_order_id' => null,
                'correlation_id' => $correlationId,
            );
        }
    }

    private function existingOutcome($existing, $correlationId)
    {
        $state = (string) $existing->submission_state;
        switch ($state) {
            case self::STATE_ACCEPTED:
            case self::STATE_TERMINATED:
                return array('ok' => true, 'message' => 'Order already submitted.', 'detail' => 'Provider order id: ' . (string) $existing->provider_order_id,
                    'state' => $state, 'provider_order_id' => (string) $existing->provider_order_id, 'correlation_id' => $correlationId);
            case self::STATE_IN_FLIGHT:
                return array('ok' => true, 'message' => 'Order submission is already in progress.', 'detail' => 'Another worker owns the submission.',
                    'state' => $state, 'provider_order_id' => null, 'correlation_id' => $correlationId);
            case self::STATE_REJECTED:
                return array('ok' => false, 'message' => (string) $existing->error_message !== '' ? (string) $existing->error_message : 'The provider previously refused this order.',
                    'detail' => 'Retry is available from the SMM admin area.', 'state' => $state,
                    'provider_order_id' => null, 'correlation_id' => $correlationId);
            case self::STATE_UNCERTAIN:
                return array('ok' => false, 'message' => 'This order is awaiting reconciliation with the provider. Reference ' . $correlationId,
                    'detail' => 'Automatic resubmission is disabled to prevent double orders.', 'state' => $state,
                    'provider_order_id' => null, 'correlation_id' => $correlationId);
            case self::STATE_AWAITING:
            default:
                return array('ok' => false, 'message' => 'Order submission is pending. Reference ' . $correlationId,
                    'detail' => 'The order will be submitted by the automation run.', 'state' => $state,
                    'provider_order_id' => null, 'correlation_id' => $correlationId);
        }
    }

    private function fail($message, $correlationId)
    {
        return array('ok' => false, 'message' => $message, 'detail' => '', 'state' => '',
            'provider_order_id' => null, 'correlation_id' => $correlationId);
    }
}
