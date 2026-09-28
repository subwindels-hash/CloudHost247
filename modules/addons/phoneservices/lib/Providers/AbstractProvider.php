<?php
/**
 * Abstract Provider Base
 *
 * Shared plumbing for every provider implementation: configuration, HTTP
 * transport (dependency-free), structured logging, error capture, phone number
 * normalisation and provider API-call auditing.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

use PhoneServices\Core\Config;
use PhoneServices\Core\Database;
use PhoneServices\Core\HttpClient;
use PhoneServices\Core\Logger;
use PhoneServices\Interfaces\TelecomProviderInterface;

abstract class AbstractProvider implements TelecomProviderInterface
{
    /** @var array<string,mixed> */
    protected $config = [];

    /** @var HttpClient */
    protected $httpClient;

    /** @var string */
    protected $apiMode = 'sandbox';

    /** @var string|null */
    protected $lastError;

    public function __construct(?HttpClient $httpClient = null)
    {
        $this->httpClient = $httpClient ?: new HttpClient();
    }

    /**
     * @param array<string,mixed> $config
     */
    public function configure(array $config): void
    {
        $this->config = array_merge($this->config, $config);

        if (isset($config['mode'])) {
            $this->apiMode = (string) $config['mode'];
        }
    }

    /**
     * @return mixed
     */
    protected function cfg(string $key, $default = '')
    {
        return $this->config[$key] ?? $default;
    }

    public function getLastError(): ?string
    {
        return $this->lastError;
    }

    public function isSandbox(): bool
    {
        return $this->apiMode !== 'live';
    }

    /**
     * Does this provider advertise a capability (sms, voice, numbers, esim...)?
     */
    public function supports(string $capability): bool
    {
        return in_array($capability, $this->getCapabilities(), true);
    }

    /* ------------------------------------------------------------------
     | HTTP helpers
     * ----------------------------------------------------------------- */

    protected function get(string $url, array $query = [], array $headers = []): array
    {
        return $this->audit('GET', $url, $this->httpClient->get($url, $query, $headers));
    }

    protected function post(string $url, array $data = [], array $headers = []): array
    {
        return $this->audit('POST', $url, $this->httpClient->postJson($url, $data, $headers));
    }

    protected function postForm(string $url, array $data = [], array $headers = []): array
    {
        return $this->audit('POST', $url, $this->httpClient->postForm($url, $data, $headers));
    }

    protected function put(string $url, array $data = [], array $headers = []): array
    {
        return $this->audit('PUT', $url, $this->httpClient->putJson($url, $data, $headers));
    }

    protected function delete(string $url, array $headers = []): array
    {
        return $this->audit('DELETE', $url, $this->httpClient->delete($url, $headers));
    }

    /**
     * Record the outcome of a provider API call (debug log + failure capture).
     *
     * @param array<string,mixed> $response
     * @return array<string,mixed>
     */
    protected function audit(string $method, string $url, array $response): array
    {
        $status = (int) ($response['status'] ?? 0);

        if ($status === 0 || $status >= 400) {
            $this->logError(
                $method . ' ' . $this->scrubUrl($url),
                (string) ($response['error'] ?? 'Request failed'),
                ['status' => $status]
            );
        } else {
            Logger::debug('[' . $this->getName() . '] ' . $method . ' ' . $this->scrubUrl($url), ['status' => $status]);
        }

        return $response;
    }

    /**
     * Strip anything credential-looking out of a URL before it is logged.
     */
    protected function scrubUrl(string $url): string
    {
        $url = preg_replace('#//[^/@]+@#', '//***@', $url);

        return preg_replace('/(api_?key|token|secret|password)=[^&]+/i', '$1=***', (string) $url);
    }

    /* ------------------------------------------------------------------
     | Logging
     * ----------------------------------------------------------------- */

    protected function log(string $action, array $context = []): void
    {
        Logger::info('[' . $this->getName() . '] ' . $action, $context);
    }

    protected function logError(string $action, string $error, array $context = []): void
    {
        $this->lastError = $error;
        Logger::error('[' . $this->getName() . '] ' . $action . ': ' . $error, $context);
    }

    /**
     * Uniform failure payload returned by provider methods.
     *
     * @return array<string,mixed>
     */
    protected function failure(string $message, array $extra = []): array
    {
        $this->lastError = $message;

        return array_merge(['success' => false, 'error' => $message], $extra);
    }

    /**
     * Uniform success payload returned by provider methods.
     *
     * @return array<string,mixed>
     */
    protected function success(array $data = []): array
    {
        return array_merge(['success' => true, 'error' => null], $data);
    }

    /* ------------------------------------------------------------------
     | Utilities
     * ----------------------------------------------------------------- */

    /**
     * Normalise a phone number to E.164.
     */
    protected function formatE164(string $number, string $country = 'US'): string
    {
        $number = preg_replace('/[^0-9+]/', '', trim($number));

        if ($number === '') {
            return '';
        }

        if (strpos($number, '+') === 0) {
            return '+' . preg_replace('/[^0-9]/', '', substr($number, 1));
        }

        // Strip international prefixes commonly typed by users (00 / 011).
        $digits = preg_replace('/^(00|011)/', '', $number);

        $dialCodes = self::dialCodes();
        $prefix = $dialCodes[strtoupper($country)] ?? '';

        if ($prefix !== '' && strpos($digits, $prefix) !== 0) {
            $digits = $prefix . ltrim($digits, '0');
        }

        return '+' . $digits;
    }

    /**
     * ISO-3166 alpha-2 => dialling code for the supported markets.
     *
     * @return array<string,string>
     */
    public static function dialCodes(): array
    {
        return [
            'US' => '1', 'CA' => '1', 'GB' => '44', 'IE' => '353', 'AU' => '61',
            'NZ' => '64', 'DE' => '49', 'FR' => '33', 'NL' => '31', 'ES' => '34',
            'IT' => '39', 'PT' => '351', 'SE' => '46', 'NO' => '47', 'DK' => '45',
            'FI' => '358', 'PL' => '48', 'CH' => '41', 'AT' => '43', 'BE' => '32',
            'JP' => '81', 'SG' => '65', 'HK' => '852', 'IN' => '91', 'ZA' => '27',
            'NG' => '234', 'KE' => '254', 'GH' => '233', 'AE' => '971', 'BR' => '55',
            'MX' => '52',
        ];
    }

    /**
     * @param string[] $required
     */
    protected function validateConfig(array $required): bool
    {
        foreach ($required as $key) {
            if (empty($this->config[$key])) {
                $this->logError('Config validation failed', "Missing required credential: {$key}");
                return false;
            }
        }

        return true;
    }

    /**
     * Callback URL for provider webhooks belonging to this provider.
     */
    protected function webhookUrl(string $event = ''): string
    {
        $base = Config::webhookBaseUrl() . '/' . $this->getName() . '.php';

        return $event === '' ? $base : $base . '?event=' . rawurlencode($event);
    }

    /**
     * Persist a provider webhook/event payload for replay + idempotency.
     */
    protected function recordEvent(string $eventType, array $payload, ?string $externalId = null): void
    {
        Database::insert('mod_phoneservices_provider_events', [
            'provider'    => $this->getName(),
            'event_type'  => $eventType,
            'external_id' => $externalId,
            'payload'     => json_encode($payload),
            'created_at'  => date('Y-m-d H:i:s'),
        ]);
    }

    abstract public function getName(): string;

    abstract public function isAvailable(): bool;

    abstract public function getCapabilities(): array;

    abstract public function testConnection(): bool;
}
