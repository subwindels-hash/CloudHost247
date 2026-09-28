<?php
namespace CloudHost247\Smm\Adapters;

/**
 * Contract every SMM provider adapter implements.
 *
 * All methods may throw:
 *  - CloudHost247\Smm\Support\AdapterException   -> the provider REFUSED the
 *    operation (definitive, safe to surface);
 *  - CloudHost247\Smm\Support\TransportException -> the exchange FAILED or its
 *    outcome is UNKNOWN (callers must reconcile, never retry blindly).
 *
 * Capability probing: supports() reports whether the adapter can even attempt
 * an operation for a given provider row, because panels differ.
 */
interface ProviderAdapter
{
    /** @return array normalized capability map: key => bool */
    public function capabilities();

    /** @param string $capability
     *  @return bool */
    public function supports($capability);

    /**
     * Connectivity + credential test.
     * @return array array('ok' => bool, 'balance' => string|null, 'currency' => string|null, 'detail' => string)
     */
    public function testConnection();

    /**
     * Fetch the provider's service catalog.
     * @return array list of normalized service rows:
     *   array('provider_service_id','name','category','description','type',
     *         'min_quantity','max_quantity','rate','currency','refill','cancel','provider_status')
     */
    public function fetchServices();

    /**
     * Submit an order.
     * @return array array('provider_order_id' => string, 'raw' => array)
     */
    public function submitOrder($providerServiceId, $link, $quantity);

    /**
     * Fetch order status.
     * @return array array('status' => string raw, 'remains' => int|null,
     *                     'start_count' => int|null, 'charge' => string|null, 'currency' => string|null)
     */
    public function orderStatus($providerOrderId);

    /** @return array array('refill_id' => string) */
    public function requestRefill($providerOrderId);

    /** @return array array('status' => string raw refill status) */
    public function refillStatus($refillId);

    /** @return array array('accepted' => bool, 'detail' => string) */
    public function requestCancel($providerOrderId);
}
