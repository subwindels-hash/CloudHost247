<?php
namespace CloudHost247\Integrations\Api;

/**
 * Outbound HTTP boundary. Implementations must never follow redirects, must
 * verify TLS, must honour the supplied timeouts and must cap the response size.
 */
interface Transport
{
    /**
     * @param string $method
     * @param string $url
     * @param array  $headers  list of "Name: value" strings
     * @param string|null $body
     * @param array  $limits   connect_timeout, timeout, max_bytes
     * @return array  status, body, latency_ms
     * @throws TransportException
     */
    public function send($method, $url, array $headers, $body, array $limits);
}
