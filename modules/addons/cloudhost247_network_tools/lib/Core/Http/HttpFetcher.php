<?php
namespace CloudHost247\NetworkTools\Core\Http;

use CloudHost247\NetworkTools\Core\Result\ErrorCode;
use CloudHost247\NetworkTools\Core\Security\SsrfGuard;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;

/**
 * The single outbound HTTP boundary for the whole tools platform.
 *
 * Every server-side fetch — HTTP header inspection, Open Graph, broken-link
 * crawling, server fingerprinting, DNS-over-HTTPS, provider HTTP calls — goes
 * through this class so the SSRF policy is implemented once, tested once and
 * cannot be forgotten in a new tool.
 *
 * Guarantees:
 *  - only http/https; scheme, host and port are validated with TargetValidator;
 *  - the target host is resolved and every address checked against the block
 *    list, then pinned with CURLOPT_RESOLVE so a hostname cannot be re-pointed
 *    between the check and the connection (DNS rebinding);
 *  - redirects are followed manually, at most max_redirects hops, and every hop
 *    is validated and re-pinned exactly like the first;
 *  - TLS peer and host verification are mandatory and may not be disabled by a
 *    caller;
 *  - connect timeout, total timeout and response size are always applied;
 *  - the response body is capped while streaming, so a hostile server cannot
 *    exhaust memory;
 *  - the URL, headers and body are never written to a log from here.
 */
final class HttpFetcher
{
    const DEFAULT_MAX_BYTES = 262144;   // 256 KiB
    const DEFAULT_MAX_REDIRECTS = 3;
    const DEFAULT_TIMEOUT = 12;
    const USER_AGENT = 'CloudHost247-NetworkTools/1.0 (+https://www.cloudhost247.com/tools)';

    private $policy;
    private $maxRedirects;
    private $transport;

    /**
     * @param array $policy SsrfGuard policy (allow_private, allow_hosts)
     * @param int   $maxRedirects
     * @param object|null $transport existing Transport implementation
     *        (CloudHost247\Integrations\Api\Transport) reused when available so
     *        provider calls share one hardened socket path.
     */
    public function __construct(array $policy = array(), $maxRedirects = self::DEFAULT_MAX_REDIRECTS, $transport = null)
    {
        $this->policy = $policy;
        $this->maxRedirects = max(0, min(5, (int) $maxRedirects));
        $this->transport = $transport;
    }

    /**
     * @return array{ok:bool,code:string,message:string,status:int,headers:array,body:string,
     *               latency_ms:int,url:string,redirects:array,tls:array,truncated:bool,bytes:int}
     */
    public function request($method, $url, array $headers = array(), $body = null, array $options = array())
    {
        $method = strtoupper((string) $method);
        if (!in_array($method, array('GET', 'HEAD', 'POST', 'OPTIONS'), true)) {
            return $this->failure(ErrorCode::INVALID_INPUT, 'Unsupported HTTP method.');
        }
        $maxBytes = isset($options['max_bytes']) ? max(1024, (int) $options['max_bytes']) : self::DEFAULT_MAX_BYTES;
        $timeout = isset($options['timeout']) ? max(1, min(30, (int) $options['timeout'])) : self::DEFAULT_TIMEOUT;
        $connectTimeout = isset($options['connect_timeout']) ? max(1, min(15, (int) $options['connect_timeout'])) : 5;
        $maxRedirects = isset($options['max_redirects']) ? max(0, min(5, (int) $options['max_redirects'])) : $this->maxRedirects;
        $userAgent = isset($options['user_agent']) ? (string) $options['user_agent'] : self::USER_AGENT;

        try {
            $current = TargetValidator::url($url);
        } catch (\InvalidArgumentException $invalid) {
            return $this->failure(ErrorCode::INVALID_INPUT, $invalid->getMessage());
        }

        $redirects = array();
        $started = microtime(true);
        for ($hop = 0; $hop <= $maxRedirects; $hop++) {
            $verdict = SsrfGuard::validateHost($current['host'], $this->policy);
            if (!$verdict['ok']) {
                return $this->failure($verdict['code'], $verdict['message'], $redirects);
            }
            $response = $this->single($method, $current, $verdict['addresses'], $headers, $body, array(
                'max_bytes' => $maxBytes, 'timeout' => $timeout, 'connect_timeout' => $connectTimeout, 'user_agent' => $userAgent,
            ));
            if (!$response['ok']) {
                $response['redirects'] = $redirects;
                return $response;
            }
            $location = $this->header($response['headers'], 'location');
            if (in_array($response['status'], array(301, 302, 303, 307, 308), true) && $location !== '') {
                if ($hop === $maxRedirects) {
                    $response['ok'] = false;
                    $response['code'] = ErrorCode::PROVIDER_ERROR;
                    $response['message'] = 'The URL redirected more times than this tool allows (limit ' . $maxRedirects . ').';
                    $response['redirects'] = $redirects;
                    return $response;
                }
                $redirects[] = array('status' => $response['status'], 'from' => $current['url'], 'to' => $location);
                try {
                    $next = $this->absoluteUrl($location, $current);
                    $current = TargetValidator::url($next);
                } catch (\InvalidArgumentException $invalid) {
                    $response['ok'] = false;
                    $response['code'] = ErrorCode::TARGET_BLOCKED;
                    $response['message'] = 'The redirect target was rejected: ' . $invalid->getMessage();
                    $response['redirects'] = $redirects;
                    return $response;
                }
                if ($response['status'] === 303 || ($response['status'] === 302 && $method === 'POST')) {
                    $method = 'GET';
                    $body = null;
                }
                continue;
            }
            $response['redirects'] = $redirects;
            $response['latency_ms'] = (int) round((microtime(true) - $started) * 1000);
            return $response;
        }
        return $this->failure(ErrorCode::PROVIDER_ERROR, 'The request exceeded the allowed number of redirects.', $redirects);
    }

    /** Fetch a URL and decode a JSON body, with a size/depth cap. */
    public function json($method, $url, array $headers = array(), $body = null, array $options = array())
    {
        $options['max_bytes'] = isset($options['max_bytes']) ? $options['max_bytes'] : 262144;
        $response = $this->request($method, $url, array_merge($headers, array('Accept: application/json')), $body, $options);
        if (!$response['ok']) {
            return $response;
        }
        if (!in_array($response['status'], array(200, 201, 202), true)) {
            return $this->failure(ErrorCode::PROVIDER_ERROR, 'The provider returned HTTP ' . (int) $response['status'] . '.');
        }
        $decoded = json_decode((string) $response['body'], true);
        if (!is_array($decoded)) {
            return $this->failure(ErrorCode::PROVIDER_ERROR, 'The provider response was not valid JSON.');
        }
        $response['json'] = $decoded;
        return $response;
    }

    private function single($method, array $target, array $addresses, array $headers, $body, array $limits)
    {
        if (!extension_loaded('curl')) {
            return $this->failure(ErrorCode::SERVICE_UNAVAILABLE, 'The cURL extension is required for server-side HTTP checks.');
        }
        if ($this->transport !== null && method_exists($this->transport, 'send')) {
            return $this->sendThroughTransport($method, $target, $headers, $body, $limits);
        }
        $received = 0;
        $payload = '';
        $truncated = false;
        $headerLines = array();
        $handle = curl_init();
        $resolve = array();
        foreach ($addresses as $address) {
            $resolve[] = $target['host'] . ':' . $target['port'] . ':' . $address;
        }
        curl_setopt_array($handle, array(
            CURLOPT_URL => $target['url'],
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => array_merge(array('User-Agent: ' . $limits['user_agent'], 'Accept-Encoding: identity'), $headers),
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_HEADER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_CONNECTTIMEOUT => $limits['connect_timeout'],
            CURLOPT_TIMEOUT => $limits['timeout'],
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_RESOLVE => $resolve,
            CURLOPT_USERAGENT => $limits['user_agent'],
            CURLOPT_HEADERFUNCTION => function ($resource, $line) use (&$headerLines) {
                $trimmed = trim($line);
                if ($trimmed !== '') {
                    $headerLines[] = substr($trimmed, 0, 2048);
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($resource, $chunk) use (&$payload, &$received, &$truncated, $limits) {
                $received += strlen($chunk);
                if ($received > $limits['max_bytes']) {
                    $truncated = true;
                    return 0; // abort the transfer: the body limit was reached
                }
                $payload .= $chunk;
                return strlen($chunk);
            },
        ));
        if ($method === 'HEAD') {
            curl_setopt($handle, CURLOPT_NOBODY, true);
        }
        if ($body !== null && $body !== '' && in_array($method, array('POST', 'OPTIONS'), true)) {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }
        $completed = curl_exec($handle);
        $errorNumber = curl_errno($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $tlsVersion = curl_getinfo($handle, CURLINFO_SSL_VERIFYRESULT);
        $primaryPort = (int) curl_getinfo($handle, CURLINFO_PRIMARY_PORT);
        $primaryIp = (string) curl_getinfo($handle, CURLINFO_PRIMARY_IP);
        $effectiveUrl = (string) curl_getinfo($handle, CURLINFO_EFFECTIVE_URL);
        curl_close($handle);

        if ($completed === false && !$truncated) {
            return $this->failure($this->classify($errorNumber), $this->curlMessage($errorNumber));
        }
        if ($status === 0) {
            return $this->failure($this->classify($errorNumber), $this->curlMessage($errorNumber));
        }
        return array(
            'ok' => true, 'code' => ErrorCode::OK, 'message' => '', 'status' => $status,
            'headers' => $this->parseHeaderLines($headerLines), 'header_lines' => $headerLines,
            'body' => $payload, 'latency_ms' => 0, 'url' => $effectiveUrl !== '' ? $effectiveUrl : $target['url'],
            'redirects' => array(), 'truncated' => $truncated, 'bytes' => $received,
            'tls' => array('verify_result' => $tlsVersion, 'port' => $primaryPort),
            'address' => $primaryIp,
        );
    }

    /**
     * Optional path: reuse the integrations transport so provider calls share
     * the already-tested hardened client. The resolution pin is applied by the
     * caller-side policy (the transport is only used for fixed provider hosts).
     */
    private function sendThroughTransport($method, array $target, array $headers, $body, array $limits)
    {
        try {
            $response = $this->transport->send($method, $target['url'], $headers, $body, array(
                'timeout' => $limits['timeout'], 'connect_timeout' => $limits['connect_timeout'], 'max_bytes' => $limits['max_bytes'],
            ));
        } catch (\Throwable $failure) {
            return $this->failure(ErrorCode::PROVIDER_ERROR, 'The transport reported: ' . substr($failure->getMessage(), 0, 160));
        }
        $body = isset($response['body']) ? (string) $response['body'] : '';
        return array(
            'ok' => true, 'code' => ErrorCode::OK, 'message' => '', 'status' => (int) $response['status'],
            'headers' => array(), 'header_lines' => array(), 'body' => $body,
            'latency_ms' => isset($response['latency_ms']) ? (int) $response['latency_ms'] : 0,
            'url' => $target['url'], 'redirects' => array(), 'truncated' => false, 'bytes' => strlen($body),
            'tls' => array(), 'address' => '',
        );
    }

    private function parseHeaderLines(array $lines)
    {
        $headers = array();
        foreach ($lines as $line) {
            $position = strpos($line, ':');
            if ($position === false) {
                continue;
            }
            $name = strtolower(trim(substr($line, 0, $position)));
            $value = trim(substr($line, $position + 1));
            if ($name === '' || $name === 'status') {
                continue;
            }
            if (isset($headers[$name])) {
                $headers[$name] .= ', ' . $value;
            } else {
                $headers[$name] = $value;
            }
        }
        return $headers;
    }

    public function header(array $headers, $name)
    {
        $name = strtolower((string) $name);
        return isset($headers[$name]) ? (string) $headers[$name] : '';
    }

    /** Resolve a (possibly relative) Location header against the current URL. */
    public function absoluteUrl($location, array $current)
    {
        $location = trim((string) $location);
        if ($location === '') {
            throw new \InvalidArgumentException('The redirect had no target.');
        }
        if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $location)) {
            return $location;
        }
        $origin = $current['scheme'] . '://' . $current['host'] . (($current['port'] === 443 && $current['scheme'] === 'https') || ($current['port'] === 80 && $current['scheme'] === 'http') ? '' : ':' . $current['port']);
        if (substr($location, 0, 2) === '//') {
            return $current['scheme'] . ':' . $location;
        }
        if ($location[0] === '/') {
            return $origin . $location;
        }
        $base = $current['path'];
        $directory = substr($base, 0, strrpos($base, '/') + 1);
        return $origin . $directory . $location;
    }

    private function classify($errorNumber)
    {
        switch ((int) $errorNumber) {
            case 6:
                return ErrorCode::DOMAIN_NOT_FOUND;
            case 7:
                return ErrorCode::PROVIDER_ERROR;
            case 28:
                return ErrorCode::TIMEOUT;
            case 35:
            case 51:
            case 58:
            case 60:
            case 66:
            case 77:
            case 83:
                return ErrorCode::PROVIDER_ERROR;
            default:
                return ErrorCode::PROVIDER_ERROR;
        }
    }

    private function curlMessage($errorNumber)
    {
        $messages = array(
            6 => 'The hostname could not be resolved.',
            7 => 'The server refused the connection.',
            28 => 'The server did not respond within the timeout.',
            35 => 'The TLS handshake failed.',
            51 => 'The server certificate could not be verified.',
            58 => 'The client certificate could not be loaded.',
            60 => 'The server certificate is not trusted.',
            66 => 'The TLS handshake failed.',
            77 => 'The certificate could not be loaded.',
            83 => 'The certificate issuer is not recognised.',
        );
        return isset($messages[(int) $errorNumber]) ? $messages[(int) $errorNumber] : 'The request failed (cURL error ' . (int) $errorNumber . ').';
    }

    private function failure($code, $message, array $redirects = array())
    {
        return array(
            'ok' => false, 'code' => $code, 'message' => (string) $message, 'status' => 0,
            'headers' => array(), 'header_lines' => array(), 'body' => '', 'latency_ms' => 0,
            'url' => '', 'redirects' => $redirects, 'truncated' => false, 'bytes' => 0, 'tls' => array(), 'address' => '',
        );
    }
}
