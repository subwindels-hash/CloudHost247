<?php
namespace CloudHost247\Integrations\Api;

/**
 * Hardened cURL transport shared by every integration.
 *
 * Redirects are disabled, TLS peer and host verification are mandatory, the
 * response body is capped, and connect/total timeouts are always applied.
 * The URL and headers are never written to a log from here.
 */
final class CurlTransport implements Transport
{
    const DEFAULT_MAX_BYTES = 1048576;

    public function send($method, $url, array $headers, $body, array $limits)
    {
        if (!extension_loaded('curl')) {
            throw new TransportException('configuration', 'cURL is required for outbound integration calls.');
        }
        $connectTimeout = isset($limits['connect_timeout']) ? max(1, min(30, (int) $limits['connect_timeout'])) : 5;
        $timeout = isset($limits['timeout']) ? max(1, min(120, (int) $limits['timeout'])) : 20;
        $maxBytes = isset($limits['max_bytes']) ? max(1024, (int) $limits['max_bytes']) : self::DEFAULT_MAX_BYTES;

        $received = 0;
        $payload = '';
        $started = microtime(true);
        $handle = curl_init();
        curl_setopt_array($handle, array(
            CURLOPT_URL => $url,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_HEADER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_CONNECTTIMEOUT => $connectTimeout,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'CloudHost247-Integrations/1.0',
            CURLOPT_WRITEFUNCTION => function ($resource, $chunk) use (&$payload, &$received, $maxBytes) {
                $received += strlen($chunk);
                if ($received > $maxBytes) { return 0; }
                $payload .= $chunk;
                return strlen($chunk);
            },
        ));
        if ($body !== null && $body !== '') {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }
        $completed = curl_exec($handle);
        $errorNumber = curl_errno($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);
        $latency = (int) round((microtime(true) - $started) * 1000);

        if ($received > $maxBytes) {
            throw new TransportException('too_large', 'The provider response exceeded the safe size limit.');
        }
        if ($completed === false) {
            throw new TransportException($this->classify($errorNumber));
        }
        return array('status' => $status, 'body' => $payload, 'latency_ms' => $latency);
    }

    private function classify($errorNumber)
    {
        switch ((int) $errorNumber) {
            case 6:  // CURLE_COULDNT_RESOLVE_HOST
                return 'dns';
            case 7:  // CURLE_COULDNT_CONNECT
                return 'connect';
            case 28: // CURLE_OPERATION_TIMEDOUT
                return 'timeout';
            case 35: // CURLE_SSL_CONNECT_ERROR
            case 51: // CURLE_PEER_FAILED_VERIFICATION
            case 60: // CURLE_SSL_CACERT
                return 'tls';
            default:
                return 'error';
        }
    }
}
