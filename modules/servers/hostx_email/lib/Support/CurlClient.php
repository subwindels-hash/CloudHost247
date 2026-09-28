<?php
/**
 * Default HTTP transport (cURL).
 *
 * Hard requirements enforced here rather than per adapter:
 *   - HTTPS only (an http:// endpoint is refused, never silently downgraded)
 *   - TLS peer and host verification always on
 *   - bounded connect and total timeouts
 *   - no redirects followed automatically (a redirect to http:// would leak
 *     the Authorization header)
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Support;

final class CurlClient implements HttpClient
{
    /** @var int */
    private $connectTimeout;

    public function __construct(int $connectTimeout = 10)
    {
        $this->connectTimeout = max(1, $connectTimeout);
    }

    /**
     * {@inheritDoc}
     */
    public function request(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 20): array
    {
        $started = microtime(true);

        $empty = [
            'status'      => 0,
            'headers'     => [],
            'body'        => '',
            'error'       => '',
            'timed_out'   => false,
            'duration_ms' => 0,
        ];

        if (stripos($url, 'https://') !== 0) {
            return array_merge($empty, ['error' => 'Refusing a non-HTTPS provider endpoint.']);
        }

        if (!function_exists('curl_init')) {
            return array_merge($empty, ['error' => 'The PHP cURL extension is not available.']);
        }

        $handle = curl_init();

        $requestHeaders = [];

        foreach ($headers as $name => $value) {
            $requestHeaders[] = $name . ': ' . $value;
        }

        $responseHeaders = [];

        curl_setopt_array($handle, [
            CURLOPT_URL               => $url,
            CURLOPT_CUSTOMREQUEST     => strtoupper($method),
            CURLOPT_RETURNTRANSFER    => true,
            CURLOPT_FOLLOWLOCATION    => false,
            CURLOPT_SSL_VERIFYPEER    => true,
            CURLOPT_SSL_VERIFYHOST    => 2,
            CURLOPT_CONNECTTIMEOUT    => $this->connectTimeout,
            CURLOPT_TIMEOUT           => max(1, $timeout),
            CURLOPT_HTTPHEADER        => $requestHeaders,
            CURLOPT_USERAGENT         => 'CloudHost247-hostx_email/' . (defined('HOSTX_EMAIL_VERSION') ? HOSTX_EMAIL_VERSION : '1.0.0'),
            CURLOPT_HEADERFUNCTION    => static function ($curl, $line) use (&$responseHeaders) {
                $parts = explode(':', $line, 2);

                if (count($parts) === 2) {
                    $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }

                return strlen($line);
            },
        ]);

        if ($body !== null && $body !== '') {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }

        $responseBody = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $errorNumber = curl_errno($handle);
        $error = $errorNumber !== 0 ? curl_error($handle) : '';

        curl_close($handle);

        return [
            'status'      => $status,
            'headers'     => $responseHeaders,
            'body'        => is_string($responseBody) ? $responseBody : '',
            'error'       => Redactor::scrub($error),
            // A timeout after the request was written is the dangerous case:
            // the remote side may have applied the change.
            'timed_out'   => in_array($errorNumber, [CURLE_OPERATION_TIMEDOUT, CURLE_GOT_NOTHING, CURLE_PARTIAL_FILE], true),
            'duration_ms' => (int) round((microtime(true) - $started) * 1000),
        ];
    }
}
