<?php
namespace CloudHost247\NetworkTools\Services\Developer;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use CloudHost247\NetworkTools\Services\Service;

/**
 * HTTP headers checker (docs section 30).
 *
 * Fetches through the SSRF-guarded fetcher (so private ranges, metadata
 * endpoints and DNS-rebinding tricks are blocked, and every redirect hop is
 * re-validated), then reports security headers, cache headers and the redirect
 * chain — each finding tied to the header that produced it.
 */
final class HttpHeadersService extends Service
{
    protected function execute()
    {
        $url = $this->input['url'];
        $method = isset($this->input['method']) ? strtoupper($this->input['method']) : 'GET';
        $fetcher = $this->fetcher(3);
        $response = $fetcher->request($method, $url, array('Accept: text/html,application/xhtml+xml,*/*;q=0.8'), null, array(
            'max_bytes' => $this->intSetting('http_max_response_bytes', 262144),
            'timeout' => max(3, (int) $this->setting('default_timeout_seconds', 10)),
        ));
        if (!$response['ok']) {
            return ToolResult::failure($response['code'], $response['message'], array('redirects' => $response['redirects']));
        }
        $headers = $response['headers'];
        $securityHeaders = $this->securityHeaders($headers);
        $cache = $this->cacheAssessment($headers);
        $redirects = array();
        foreach ($response['redirects'] as $hop) {
            $redirects[] = $hop;
        }
        if (in_array($response['status'], array(301, 302, 303, 307, 308), true) && $fetcher->header($headers, 'location') !== '') {
            $redirects[] = array('status' => $response['status'], 'from' => $response['url'], 'to' => $fetcher->header($headers, 'location'), 'followed' => false);
        }
        $missing = array();
        foreach ($securityHeaders as $header) {
            if ($header['present'] !== true) {
                $missing[] = $header['name'];
            }
        }
        return ToolResult::success(array(
            'url' => $response['url'],
            'requested_url' => $url,
            'status_code' => (int) $response['status'],
            'status_class' => (int) substr((string) $response['status'], 0, 1),
            'server' => $fetcher->header($headers, 'server'),
            'content_type' => $fetcher->header($headers, 'content-type'),
            'content_length' => $fetcher->header($headers, 'content-length'),
            'powered_by' => $fetcher->header($headers, 'x-powered-by'),
            'headers' => $headers,
            'header_count' => count($headers),
            'security_headers' => $securityHeaders,
            'missing_security_headers' => $missing,
            'cache' => $cache,
            'redirects' => $redirects,
            'https' => strpos($response['url'], 'https://') === 0,
            'response_time_ms' => (int) $response['latency_ms'],
            'response_bytes' => isset($response['bytes']) ? (int) $response['bytes'] : 0,
            'truncated' => !empty($response['truncated']),
            'summary' => 'HTTP ' . (int) $response['status'] . ' from ' . $response['url'] . ($missing ? ', ' . count($missing) . ' security header(s) missing.' : ', all checked security headers present.'),
            'explanation' => 'Each security header below is judged only on what this response contained. A missing header is a hardening opportunity, not proof of a vulnerability; the request left from the CloudHost247 server.',
        ), array_values(array_filter(array(
            empty($response['truncated']) ? '' : 'The response body was larger than the configured limit and was truncated; only headers and the first part of the body were received.',
            strpos($response['url'], 'http://') === 0 ? 'This URL was served over plain HTTP; use HTTPS so the response cannot be modified in transit.' : '',
        ))), array('checked_at' => gmdate('c'), 'redirects_followed' => count($response['redirects'])));
    }

    private function securityHeaders(array $headers)
    {
        $definitions = array(
            array('name' => 'strict-transport-security', 'label' => 'Strict-Transport-Security (HSTS)', 'why' => 'Tells browsers to use HTTPS for this site for the stated duration.'),
            array('name' => 'content-security-policy', 'label' => 'Content-Security-Policy', 'why' => 'Restricts which resources the page may load, which is the main mitigation for injected script.'),
            array('name' => 'x-content-type-options', 'label' => 'X-Content-Type-Options', 'why' => 'Stops browsers from re-interpreting a declared content type (should be "nosniff").'),
            array('name' => 'x-frame-options', 'label' => 'X-Frame-Options', 'why' => 'Prevents the page being framed by another site (clickjacking). Superseded by CSP frame-ancestors, but still widely used.'),
            array('name' => 'referrer-policy', 'label' => 'Referrer-Policy', 'why' => 'Controls how much URL information is sent to other sites.'),
            array('name' => 'permissions-policy', 'label' => 'Permissions-Policy', 'why' => 'Restricts browser features (camera, geolocation, ...) for the page.'),
            array('name' => 'x-xss-protection', 'label' => 'X-XSS-Protection', 'why' => 'Legacy header; modern browsers ignore it in favour of CSP.'),
        );
        $out = array();
        foreach ($definitions as $definition) {
            $value = isset($headers[$definition['name']]) ? (string) $headers[$definition['name']] : '';
            $out[] = array(
                'name' => $definition['name'],
                'label' => $definition['label'],
                'present' => $value !== '',
                'value' => $value,
                'why' => $definition['why'],
            );
        }
        return $out;
    }

    private function cacheAssessment(array $headers)
    {
        $cacheControl = isset($headers['cache-control']) ? (string) $headers['cache-control'] : '';
        $age = isset($headers['age']) ? (int) $headers['age'] : null;
        $expires = isset($headers['expires']) ? (string) $headers['expires'] : '';
        $etag = isset($headers['etag']) ? (string) $headers['etag'] : '';
        $lastModified = isset($headers['last-modified']) ? (string) $headers['last-modified'] : '';
        $notes = array();
        if ($cacheControl === '') {
            $notes[] = 'No Cache-Control header was sent, so intermediaries apply their own heuristics.';
        }
        if (stripos($cacheControl, 'no-store') !== false) {
            $notes[] = 'no-store: the response must not be written to any cache.';
        }
        if (stripos($cacheControl, 'private') !== false) {
            $notes[] = 'private: only the browser may cache this response.';
        }
        if (stripos($cacheControl, 'public') !== false) {
            $notes[] = 'public: shared caches may store this response.';
        }
        if ($age !== null) {
            $notes[] = 'The response was served from a cache ' . $age . ' second(s) ago.';
        }
        if ($etag !== '' || $lastModified !== '') {
            $notes[] = 'A validator (' . ($etag !== '' ? 'ETag' : 'Last-Modified') . ') is present, so conditional requests can revalidate cheaply.';
        }
        return array('cache_control' => $cacheControl, 'age' => $age, 'expires' => $expires, 'etag' => $etag, 'last_modified' => $lastModified, 'notes' => $notes);
    }
}
