<?php
/**
 * CloudHost247 Tools - REST API support layer.
 *
 * Implements the token-authenticated JSON API served by api/index.php and the
 * shared response-cache policy used by both the client-area AJAX endpoint and
 * the REST API. No output happens here — callers receive arrays and decide how
 * to respond, which keeps this layer testable.
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/functions.php';

/**
 * Tools whose results depend on the requesting client (their IP, user agent
 * or per-session state) must never be served from a shared response cache.
 */
function cloudhost247_tools_cache_exempt_tools()
{
    return array(
        'what_is_my_ip',      // reflects the caller's address
        'user_agent',         // reflects the caller's agent
        'online_notepad',     // per-session state
        'multi_url_opener',   // client-side only, nothing to cache
        'password_encryptor', // user-supplied secret, must not persist
        'password_generator', // random per request
        'qr_scanner',         // client-side only
        'reverse_image_search', // builds links from user input
    );
}

/**
 * Whether a tool's successful result may be cached at the dispatcher level.
 * Live-state probes (ping, traceroute, port checks, availability/username
 * checks, broken links, SMTP tests) stay uncached so the answer is always
 * current; DNS/IP/SSL/WHOIS-derived lookups are cached for cache_duration.
 */
function cloudhost247_tools_is_cacheable($toolId)
{
        static $cacheable = null;
        if ($cacheable === null) {
            // Keyed map so membership is an isset() lookup (a plain value list
            // made isset() always false — the cache silently never worked).
            $cacheable = array_fill_keys(array(
                // DNS lookups
                'spf_checker', 'domain_dns_validation', 'dns_lookup', 'cname_lookup',
                'ns_lookup', 'mx_lookup', 'dns_propagation', 'dmarc_lookup', 'dns_health',
                'dnskey_lookup', 'ds_record_lookup', 'dkim_checker', 'reverse_ip_lookup',
                // IP / network identity lookups
                'domain_to_ip', 'ip_to_hostname', 'ip_location', 'isp_checker',
                'ip_whois', 'ipv6_whois', 'ip_blacklist', 'asn_lookup', 'mac_lookup',
                // TLS / HTTP metadata
                'ssl_checker', 'http_headers', 'server_os_detector', 'pagerank',
            ), true);
        }
        return isset($cacheable[$toolId]) && !in_array($toolId, cloudhost247_tools_cache_exempt_tools(), true);
}

/**
 * Build a deterministic cache key for a tool invocation.
 * Parameters are sorted so {a,b} and {b,a} share a cache entry; the CSRF
 * token and the tool name itself are excluded.
 *
 * @param string $toolId
 * @param array  $params
 * @return string
 */
function cloudhost247_tools_result_cache_key($toolId, array $params)
{
    unset($params['tool'], $params['csrf_token'], $params['token']);
    if (isset($params) && is_array($params)) {
        ksort($params);
    }
    return 'result_' . $toolId . '_' . md5(json_encode($params));
}

/**
 * Execute a tool handler with dispatcher-level response caching.
 *
 * Contract: returns an array envelope:
 *   array('ok' => bool, 'data' => array, 'cached' => bool, 'error' => string)
 * Never throws — handler exceptions are converted into error envelopes.
 *
 * @param string $toolId   Registered tool id.
 * @param array  $params   Input parameters (usually $_POST).
 * @param bool   $useCache Whether dispatcher caching applies.
 * @return array
 */
function cloudhost247_tools_execute_tool($toolId, array $params, $useCache = true)
{
    $info = cloudhost247_tools_get_tool_info($toolId);
    if (!$info || !cloudhost247_tools_is_tool_enabled($toolId)) {
        return array('ok' => false, 'data' => array(), 'cached' => false, 'error' => 'Tool not found or disabled');
    }

    $category = $info['category'];
    $toolFile = __DIR__ . '/tools/' . $category . '_tools.php';
    if (!is_file($toolFile)) {
        return array('ok' => false, 'data' => array(), 'cached' => false, 'error' => 'Tool implementation not found');
    }
    require_once $toolFile;

    $handler = 'cloudhost247_tool_' . preg_replace('/[^a-z0-9_]/', '', $toolId);
    if (!function_exists($handler)) {
        return array('ok' => false, 'data' => array(), 'cached' => false, 'error' => 'Tool handler not implemented');
    }

    $cacheable = $useCache && cloudhost247_tools_is_cacheable($toolId);
    $cacheKey = cloudhost247_tools_result_cache_key($toolId, $params);

    if ($cacheable) {
        $cached = cloudhost247_tools_cache_get($cacheKey);
        if ($cached !== null && !isset($cached['error'])) {
            return array('ok' => true, 'data' => $cached, 'cached' => true, 'error' => '');
        }
    }

    try {
        $result = call_user_func($handler, $params);
    } catch (\Throwable $e) {
        cloudhost247_tools_log($toolId, $params, '', 'error', $e->getMessage());
        return array('ok' => false, 'data' => array(), 'cached' => false, 'error' => 'Tool execution failed');
    }

    if (isset($result['error'])) {
        cloudhost247_tools_log($toolId, $params, '', 'error', (string) $result['error']);
        return array('ok' => false, 'data' => array(), 'cached' => false, 'error' => (string) $result['error']);
    }

    cloudhost247_tools_log($toolId, $params, $result, 'success');
    if ($cacheable) {
        cloudhost247_tools_cache_set($cacheKey, $result);
    }
    return array('ok' => true, 'data' => $result, 'cached' => false, 'error' => '');
}

/**
 * The configured API token (module setting `api_token`). An empty token
 * disables the REST API entirely — the endpoint refuses every request.
 *
 * @return string
 */
function cloudhost247_tools_api_token()
{
    return (string) cloudhost247_tools_get_setting('api_token', '');
}

/**
 * Extract the presented token: X-API-Token header, Authorization: Bearer or
 * POST body parameter (in that order).
 *
 * @return string
 */
function cloudhost247_tools_api_extract_token()
{
    $headers = function_exists('getallheaders') ? array_change_key_case(getallheaders(), CASE_UPPER) : array();
    if (isset($headers['X-API-TOKEN']) && is_string($headers['X-API-TOKEN'])) {
        return trim($headers['X-API-TOKEN']);
    }
    if (isset($headers['AUTHORIZATION']) && preg_match('/^Bearer\s+(.+)$/i', $headers['AUTHORIZATION'], $m)) {
        return trim($m[1]);
    }
    if (isset($_SERVER['HTTP_AUTHORIZATION']) && preg_match('/^Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'], $m)) {
        return trim($m[1]);
    }
    if (isset($_POST['token']) && is_string($_POST['token'])) {
        return trim($_POST['token']);
    }
    return '';
}

/**
 * Constant-time token comparison. With no token configured the API stays
 * disabled so a default install never exposes an open endpoint.
 *
 * @param string $presented
 * @return bool
 */
function cloudhost247_tools_api_authorized($presented)
{
    $configured = cloudhost247_tools_api_token();
    if ($configured === '' || $presented === '') {
        return false;
    }
    return hash_equals($configured, $presented);
}

/**
 * Client-stateful or requester-reflective tools are excluded from the REST
 * API: their answers depend on the caller's session/IP and make no sense
 * (or leak context) when invoked with a shared integration token.
 *
 * @return array tool_id => name, for the enabled, API-eligible tools
 */
function cloudhost247_tools_api_catalog()
{
    $excluded = array('what_is_my_ip', 'online_notepad', 'multi_url_opener', 'qr_scanner');
    $catalog = array();
    foreach (cloudhost247_tools_get_enabled_tools() as $category => $tools) {
        foreach ($tools as $toolId => $tool) {
            if (in_array($toolId, $excluded, true)) {
                continue;
            }
            $catalog[$toolId] = array(
                'name' => $tool['name'],
                'category' => $category,
                'cacheable' => cloudhost247_tools_is_cacheable($toolId),
            );
        }
    }
    return $catalog;
}

/**
 * Rate-limit key for an API caller. Keyed by a hash of the token (not the
 * token itself) so the rate-limit table never stores credentials.
 *
 * @param string $presentedToken
 * @return string
 */
function cloudhost247_tools_api_rate_key($presentedToken)
{
    return 'api:' . substr(sha1($presentedToken), 0, 39);
}

/**
 * Dispatch one REST API request (already authenticated).
 * Pure logic — no output; returns an array with an HTTP status hint.
 *
 * @param string $action 'list' or 'run'
 * @param array  $params Input parameters (for 'run')
 * @param string $rateKey Rate-limit bucket key
 * @return array array('status' => int, 'body' => array)
 */
function cloudhost247_tools_api_dispatch($action, array $params, $rateKey)
{
    if ($action !== 'list' && $action !== 'run') {
        return array('status' => 400, 'body' => array('success' => false, 'message' => 'Invalid action. Use action=list or action=run.'));
    }

    $maxRequests = (int) cloudhost247_tools_get_setting('rate_limit_requests', '60');
    if (!cloudhost247_tools_check_rate_limit($rateKey, $maxRequests)) {
        return array('status' => 429, 'body' => array('success' => false, 'message' => 'Rate limit exceeded.'));
    }

    if ($action === 'list') {
        return array('status' => 200, 'body' => array('success' => true, 'tools' => cloudhost247_tools_api_catalog()));
    }

    $toolId = isset($params['tool']) && is_string($params['tool']) ? preg_replace('/[^a-z0-9_]/', '', strtolower(trim($params['tool']))) : '';
    $excluded = array('what_is_my_ip', 'online_notepad', 'multi_url_opener', 'qr_scanner');
    if ($toolId === '' || !cloudhost247_tools_get_tool_info($toolId)) {
        return array('status' => 404, 'body' => array('success' => false, 'message' => 'Unknown tool.'));
    }
    if (in_array($toolId, $excluded, true)) {
        return array('status' => 400, 'body' => array('success' => false, 'message' => 'Tool is not available through the API.'));
    }

    $started = microtime(true);
    $result = cloudhost247_tools_execute_tool($toolId, $params, true);
    $tookMs = (int) round((microtime(true) - $started) * 1000);

    if (!$result['ok']) {
        return array('status' => 422, 'body' => array('success' => false, 'tool' => $toolId, 'message' => $result['error']));
    }

    return array(
        'status' => 200,
        'body' => array(
            'success' => true,
            'tool' => $toolId,
            'cached' => $result['cached'],
            'took_ms' => $tookMs,
            'data' => $result['data'],
        ),
    );
}
