<?php
/**
 * HttpClient - dependency-free HTTP transport for provider integrations.
 *
 * Uses Guzzle when WHMCS/Composer provides it, and transparently falls back to
 * cURL otherwise, so provider classes never fatal because of a missing vendor
 * directory. Every response is normalised to:
 *
 *   ['status' => int, 'body' => array|null, 'raw' => string, 'error' => ?string]
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

class HttpClient
{
    /** @var int */
    private $timeout;

    /** @var int */
    private $connectTimeout;

    /** @var int Number of retries for transient failures (5xx / network). */
    private $retries;

    /** @var array<string,string> */
    private $defaultHeaders = [];

    public function __construct(int $timeout = 30, int $connectTimeout = 10, int $retries = 2)
    {
        $this->timeout = $timeout;
        $this->connectTimeout = $connectTimeout;
        $this->retries = max(0, $retries);
    }

    /**
     * @param array<string,string> $headers
     */
    public function setDefaultHeaders(array $headers): void
    {
        $this->defaultHeaders = $headers;
    }

    /**
     * @param array<string,mixed> $query
     * @param array<string,string> $headers
     */
    public function get(string $url, array $query = [], array $headers = []): array
    {
        if ($query) {
            $url .= (strpos($url, '?') === false ? '?' : '&') . http_build_query($query);
        }

        return $this->request('GET', $url, null, $headers);
    }

    /**
     * JSON POST.
     */
    public function postJson(string $url, array $payload = [], array $headers = []): array
    {
        $headers['Content-Type'] = 'application/json';

        return $this->request('POST', $url, json_encode($payload), $headers);
    }

    /**
     * application/x-www-form-urlencoded POST (Twilio, Vonage and most
     * telecom REST APIs expect this).
     */
    public function postForm(string $url, array $payload = [], array $headers = []): array
    {
        $headers['Content-Type'] = 'application/x-www-form-urlencoded';

        return $this->request('POST', $url, http_build_query($payload), $headers);
    }

    public function putJson(string $url, array $payload = [], array $headers = []): array
    {
        $headers['Content-Type'] = 'application/json';

        return $this->request('PUT', $url, json_encode($payload), $headers);
    }

    public function delete(string $url, array $headers = []): array
    {
        return $this->request('DELETE', $url, null, $headers);
    }

    /**
     * Perform the request with retry/backoff on transient errors.
     *
     * @param string|null $body
     * @param array<string,string> $headers
     */
    public function request(string $method, string $url, ?string $body = null, array $headers = []): array
    {
        $headers = array_merge($this->defaultHeaders, $headers);
        $attempt = 0;

        do {
            $response = $this->send($method, $url, $body, $headers);
            $transient = $response['status'] === 0 || $response['status'] >= 500 || $response['status'] === 429;

            if (!$transient || $attempt >= $this->retries) {
                return $response;
            }

            // Exponential backoff: 200ms, 400ms, 800ms ...
            usleep((int) (200000 * pow(2, $attempt)));
            $attempt++;
        } while ($attempt <= $this->retries);

        return $response;
    }

    /**
     * @param array<string,string> $headers
     */
    private function send(string $method, string $url, ?string $body, array $headers): array
    {
        if (!function_exists('curl_init')) {
            return $this->failure('cURL extension is not available');
        }

        $handle = curl_init();

        $headerLines = [];
        foreach ($headers as $name => $value) {
            $headerLines[] = is_int($name) ? (string) $value : $name . ': ' . $value;
        }

        curl_setopt_array($handle, [
            CURLOPT_URL            => $url,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => $this->connectTimeout,
            CURLOPT_HTTPHEADER     => $headerLines,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT      => 'PhoneServices-WHMCS/' . (defined('PHONESERVICES_VERSION') ? PHONESERVICES_VERSION : '1.0'),
        ]);

        if ($body !== null && $body !== '') {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }

        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $error = curl_errno($handle) ? curl_error($handle) : null;
        curl_close($handle);

        if ($raw === false) {
            return $this->failure($error ?: 'Unknown transport error');
        }

        $decoded = json_decode((string) $raw, true);

        return [
            'status' => $status,
            'body'   => is_array($decoded) ? $decoded : null,
            'raw'    => (string) $raw,
            'error'  => $status >= 400 ? self::extractError($decoded, (string) $raw) : null,
        ];
    }

    /**
     * Best-effort extraction of a provider error message.
     *
     * @param mixed $decoded
     */
    public static function extractError($decoded, string $raw): string
    {
        if (is_array($decoded)) {
            foreach (['message', 'error', 'error_message', 'detail', 'title'] as $key) {
                if (isset($decoded[$key])) {
                    if (is_string($decoded[$key])) {
                        return $decoded[$key];
                    }
                    if (is_array($decoded[$key]) && isset($decoded[$key]['message']) && is_string($decoded[$key]['message'])) {
                        return $decoded[$key]['message'];
                    }
                }
            }

            if (isset($decoded['errors'][0]['message']) && is_string($decoded['errors'][0]['message'])) {
                return $decoded['errors'][0]['message'];
            }
        }

        return $raw === '' ? 'Request failed' : substr($raw, 0, 500);
    }

    private function failure(string $message): array
    {
        return ['status' => 0, 'body' => null, 'raw' => '', 'error' => $message];
    }

    /**
     * Build an HTTP Basic authorization header value.
     */
    public static function basicAuth(string $username, string $password): string
    {
        return 'Basic ' . base64_encode($username . ':' . $password);
    }
}
