<?php
namespace CloudHost247\Smm\Adapters;

use CloudHost247\Smm\Support\HttpTransport;
use CloudHost247\Smm\Support\AdapterException;
use CloudHost247\Smm\Support\Crypto;
use RuntimeException;

/**
 * Builds adapters from provider rows. New provider formats plug in here
 * without any change to the order-processing core.
 */
final class AdapterFactory
{
    private $transport;

    public function __construct(HttpTransport $transport = null)
    {
        $this->transport = $transport ?: new \CloudHost247\Smm\Support\CurlTransport();
    }

    /** @return array adapter_key => label, for the admin UI. */
    public static function availableAdapters()
    {
        return array(
            'generic' => 'Generic SMM Panel API v2 (key + action POST)',
        );
    }

    /**
     * @param array|object $providerRow row from mod_cloudhost247_smm_providers
     * @return ProviderAdapter
     * @throws RuntimeException
     */
    public function forProvider($providerRow)
    {
        $row = is_object($providerRow) ? get_object_vars($providerRow) : (array) $providerRow;
        $adapter = isset($row['adapter']) ? (string) $row['adapter'] : 'generic';
        $apiUrl = isset($row['api_url']) ? (string) $row['api_url'] : '';
        $envelope = isset($row['api_key_encrypted']) ? (string) $row['api_key_encrypted'] : '';
        $timeout = isset($row['request_timeout']) ? (int) $row['request_timeout'] : 20;
        if ($apiUrl === '' || $envelope === '') {
            throw new AdapterException('Provider is not fully configured (API URL or stored key missing).');
        }
        $apiKey = Crypto::decrypt($envelope);
        $refill = array_key_exists('refill_supported', $row) && $row['refill_supported'] !== null ? (bool) $row['refill_supported'] : null;
        $cancel = array_key_exists('cancel_supported', $row) && $row['cancel_supported'] !== null ? (bool) $row['cancel_supported'] : null;
        switch ($adapter) {
            case 'generic':
                return new GenericSmmAdapter($apiUrl, $apiKey, $this->transport, $timeout, $refill, $cancel);
            default:
                throw new AdapterException('Unknown adapter: ' . $adapter);
        }
    }
}
