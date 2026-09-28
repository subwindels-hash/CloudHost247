<?php
namespace CloudHost247\Smm\Adapters;

use CloudHost247\Smm\Support\AdapterException;
use CloudHost247\Smm\Support\HttpTransport;
use CloudHost247\Smm\Support\TransportException;
use CloudHost247\Smm\Support\UrlPolicy;
use RuntimeException;

/**
 * Adapter for the de-facto "Generic SMM Panel API v2" format used by a large
 * number of panels: one POST endpoint, form parameters `key` and `action`,
 * JSON responses. Panels that deviate get their own adapter; nothing here is
 * assumed to be universal — every response is validated before use.
 *
 * Implemented operations (probed per provider):
 *   services        action=services            (catalog)
 *   balance         action=balance             (connection test)
 *   add             action=add                 (order submission)
 *   status          action=status              (order status)
 *   refill          action=refill              (optional; probed)
 *   refill_status   action=refill_status       (optional; probed)
 *   cancel          action=cancel              (optional; probed)
 */
final class GenericSmmAdapter implements ProviderAdapter
{
    const CAP_TEST = 'test_connection';
    const CAP_SERVICES = 'fetch_services';
    const CAP_SUBMIT = 'submit_order';
    const CAP_STATUS = 'order_status';
    const CAP_REFILL = 'refill';
    const CAP_REFILL_STATUS = 'refill_status';
    const CAP_CANCEL = 'cancel';

    private $apiUrl;
    private $apiKey;
    private $transport;
    private $timeout;
    private $refillSupported;
    private $cancelSupported;

    /**
     * @param string               $apiUrl  https endpoint
     * @param string               $apiKey  provider api key (plaintext, in memory only)
     * @param HttpTransport        $transport
     * @param int                  $timeout
     * @param bool|null            $refillSupported null = probe from catalog responses
     * @param bool|null            $cancelSupported  null = probe from catalog responses
     */
    public function __construct($apiUrl, $apiKey, HttpTransport $transport, $timeout = 20, $refillSupported = null, $cancelSupported = null)
    {
        $this->apiUrl = UrlPolicy::assertProviderEndpoint($apiUrl);
        $this->apiKey = (string) $apiKey;
        if ($this->apiKey === '') {
            throw new AdapterException('Provider API key is empty.');
        }
        $this->transport = $transport;
        $this->timeout = (int) $timeout;
        $this->refillSupported = $refillSupported;
        $this->cancelSupported = $cancelSupported;
    }

    public function capabilities()
    {
        return array(
            self::CAP_TEST => true,
            self::CAP_SERVICES => true,
            self::CAP_SUBMIT => true,
            self::CAP_STATUS => true,
            self::CAP_REFILL => (bool) $this->refillSupported,
            self::CAP_REFILL_STATUS => (bool) $this->refillSupported,
            self::CAP_CANCEL => (bool) $this->cancelSupported,
        );
    }

    public function supports($capability)
    {
        $caps = $this->capabilities();
        return isset($caps[$capability]) && $caps[$capability];
    }

    public function testConnection()
    {
        try {
            $result = $this->call('balance');
        } catch (AdapterException $e) {
            return array('ok' => false, 'balance' => null, 'currency' => null, 'detail' => $e->getMessage());
        }
        $balance = isset($result['balance']) ? (string) $result['balance'] : null;
        $currency = isset($result['currency']) ? (string) $result['currency'] : null;
        return array('ok' => true, 'balance' => $balance, 'currency' => $currency, 'detail' => 'Connection and key verified.');
    }

    public function fetchServices()
    {
        $rows = $this->call('services');
        if (!is_array($rows)) {
            throw new AdapterException('Provider service list is not a JSON array.');
        }
        $out = array();
        $sawRefill = false;
        $sawCancel = false;
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue; // malformed entry: skip, never invent values
            }
            $id = isset($row['service']) ? trim((string) $row['service']) : '';
            $name = isset($row['name']) ? trim((string) $row['name']) : '';
            if ($id === '' || $name === '' || strlen($id) > 64) {
                continue; // unusable entry
            }
            $refill = array_key_exists('refill', $row) ? self::toBool($row['refill']) : false;
            $cancel = array_key_exists('cancel', $row) ? self::toBool($row['cancel']) : false;
            if ($refill) { $sawRefill = true; }
            if ($cancel) { $sawCancel = true; }
            $out[] = array(
                'provider_service_id' => $id,
                'name' => mb_substr($name, 0, 250),
                'category' => mb_substr(isset($row['category']) ? trim((string) $row['category']) : '', 0, 120),
                'description' => mb_substr(isset($row['description']) ? trim((string) $row['description']) : '', 0, 1000),
                'type' => mb_substr(isset($row['type']) ? trim((string) $row['type']) : '', 0, 64),
                'min_quantity' => self::optionalInt($row, 'min'),
                'max_quantity' => self::optionalInt($row, 'max'),
                'rate' => self::optionalDecimal($row, 'rate'),
                'currency' => mb_substr(isset($row['currency']) ? trim((string) $row['currency']) : '', 0, 8),
                'refill' => $refill,
                'cancel' => $cancel,
                'provider_status' => 'active',
            );
        }
        // Probe-driven capability hints for panels that flag refill/cancel per service.
        if ($this->refillSupported === null) { $this->refillSupported = $sawRefill; }
        if ($this->cancelSupported === null) { $this->cancelSupported = $sawCancel; }
        return $out;
    }

    public function submitOrder($providerServiceId, $link, $quantity)
    {
        $providerServiceId = trim((string) $providerServiceId);
        if ($providerServiceId === '') {
            throw new AdapterException('Provider service id is required.');
        }
        $result = $this->call('add', array(
            'service' => $providerServiceId,
            'link' => (string) $link,
            'quantity' => (string) (int) $quantity,
        ));
        $orderId = isset($result['order']) ? trim((string) $result['order']) : '';
        if ($orderId === '' || strlen($orderId) > 64) {
            throw new AdapterException('Provider accepted the request but returned no usable order id.');
        }
        return array('provider_order_id' => $orderId, 'raw' => $result);
    }

    public function orderStatus($providerOrderId)
    {
        $providerOrderId = trim((string) $providerOrderId);
        if ($providerOrderId === '') {
            throw new AdapterException('Provider order id is required.');
        }
        $result = $this->call('status', array('order' => $providerOrderId));
        $status = isset($result['status']) ? trim((string) $result['status']) : '';
        if ($status === '') {
            throw new AdapterException('Provider returned a status response without a status.');
        }
        return array(
            'status' => mb_substr($status, 0, 64),
            'remains' => self::optionalInt($result, 'remains'),
            'start_count' => self::optionalInt($result, 'start_count'),
            'charge' => self::optionalDecimal($result, 'charge'),
            'currency' => mb_substr(isset($result['currency']) ? trim((string) $result['currency']) : '', 0, 8),
        );
    }

    public function requestRefill($providerOrderId)
    {
        if (!$this->supports(self::CAP_REFILL)) {
            throw new AdapterException('This provider does not expose refill requests.');
        }
        $result = $this->call('refill', array('order' => trim((string) $providerOrderId)));
        $refillId = isset($result['refill']) ? trim((string) $result['refill']) : '';
        if ($refillId === '') {
            throw new AdapterException('Provider returned no refill id.');
        }
        return array('refill_id' => mb_substr($refillId, 0, 64));
    }

    public function refillStatus($refillId)
    {
        if (!$this->supports(self::CAP_REFILL_STATUS)) {
            throw new AdapterException('This provider does not expose refill status.');
        }
        $result = $this->call('refill_status', array('refill' => trim((string) $refillId)));
        $status = isset($result['status']) ? trim((string) $result['status']) : '';
        return array('status' => mb_substr($status, 0, 64));
    }

    public function requestCancel($providerOrderId)
    {
        if (!$this->supports(self::CAP_CANCEL)) {
            throw new AdapterException('This provider does not expose cancellation requests.');
        }
        // Many panels answer a successful cancel with an empty object or just {"error": "..."}.
        $result = $this->call('cancel', array('order' => trim((string) $providerOrderId)));
        return array('accepted' => true, 'detail' => 'Cancellation request accepted.', 'raw' => $result);
    }

    /** Exposed for the catalog-driven capability probe. */
    public function observedCapabilities()
    {
        return array('refill' => (bool) $this->refillSupported, 'cancel' => (bool) $this->cancelSupported);
    }

    // ------------------------------------------------------------------ core

    private function call($action, array $extra = array())
    {
        $data = array_merge(array('key' => $this->apiKey, 'action' => $action), $extra);
        $response = $this->transport->postForm($this->apiUrl, $data, $this->timeout);
        $decoded = json_decode((string) $response['body'], true, 16);
        if (!is_array($decoded)) {
            throw new TransportException('Provider response is not valid JSON.');
        }
        if (array_key_exists('error', $decoded) && $decoded['error'] !== '' && $decoded['error'] !== null && $decoded['error'] !== false) {
            throw new AdapterException('Provider rejected the request: ' . mb_substr(trim((string) $decoded['error']), 0, 300), 0, $decoded['error']);
        }
        return $decoded;
    }

    private static function toBool($value)
    {
        if (is_bool($value)) { return $value; }
        if (is_int($value) || is_float($value)) { return $value != 0; }
        if (is_string($value)) {
            $v = strtolower(trim($value));
            return $v === '1' || $v === 'true' || $v === 'yes' || $v === 'on';
        }
        return false;
    }

    private static function optionalInt(array $row, $key)
    {
        if (!array_key_exists($key, $row) || $row[$key] === '' || $row[$key] === null) {
            return null;
        }
        if (!is_numeric($row[$key])) {
            return null;
        }
        return (int) $row[$key];
    }

    private static function optionalDecimal(array $row, $key)
    {
        if (!array_key_exists($key, $row) || $row[$key] === '' || $row[$key] === null) {
            return null;
        }
        if (!is_numeric($row[$key])) {
            return null;
        }
        return (string) (float) $row[$key];
    }
}
