<?php
namespace CloudHost247\Smm\Support;

/**
 * Boundary contract for HTTP transports.
 *
 * Adapters depend on this interface so automated tests can inject fixtures
 * and so the production cURL implementation can be replaced without touching
 * provider logic. Implementations MUST:
 *  - refuse non-HTTPS URLs,
 *  - verify TLS certificates,
 *  - not follow redirects while carrying credentials,
 *  - enforce connect/read timeouts and a response size limit.
 */
interface HttpTransport
{
    /**
     * @param string $url     absolute HTTPS URL
     * @param array  $data    form fields (must include credentials)
     * @param int    $timeout total read timeout in seconds
     * @return array array('status' => int, 'body' => string)
     * @throws TransportException on network failure, non-2xx status or oversize body
     */
    public function postForm($url, array $data, $timeout = 20);
}
