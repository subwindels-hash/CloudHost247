<?php
namespace CloudHost247\Smm\Support;

/**
 * Production cURL transport.
 *
 * Security posture (matches the module security policy):
 *  - HTTPS-only, certificate verification on (VERIFYHOST 2 / VERIFYPEER true)
 *  - never follows redirects, so the API key cannot leak to a redirect target
 *  - bounded connect (5s) and total timeouts
 *  - response bodies above the safety limit are rejected unread
 *  - transport failures raise TransportException, which callers treat as an
 *    UNKNOWN OUTCOME (never as a provider rejection)
 */
final class CurlTransport implements HttpTransport
{
    const MAX_BODY_BYTES = 2097152; // 2 MiB is far above any legitimate SMM payload

    public function postForm($url, array $data, $timeout = 20)
    {
        UrlPolicy::assertProviderEndpoint($url);
        if (!extension_loaded('curl')) {
            throw new TransportException('The cURL PHP extension is required.');
        }
        $timeout = max(5, min(120, (int) $timeout));
        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($data, '', '&'),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'CloudHost247-SMM/1.0 (+WHMCS module)',
            CURLOPT_HTTPHEADER => array('Accept: application/json'),
            CURLOPT_BUFFERSIZE => 65536,
        ));
        $body = curl_exec($ch);
        $error = curl_error($ch);
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($body === false || $error !== '' || $errno !== 0) {
            throw new TransportException('Provider network error: ' . ($error !== '' ? $error : 'cURL error ' . $errno));
        }
        if ($status < 200 || $status >= 300) {
            throw new TransportException('Provider returned HTTP ' . $status . '.');
        }
        if (strlen($body) > self::MAX_BODY_BYTES) {
            throw new TransportException('Provider response exceeds the safety limit.');
        }
        return array('status' => $status, 'body' => $body);
    }
}
