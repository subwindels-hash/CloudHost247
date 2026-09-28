<?php
/**
 * CloudHost247 Tools - Core Helper Functions
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

use Illuminate\Database\Capsule\Manager as Capsule;

/**
 * Sanitize user input
 */
function cloudhost247_tools_sanitize($input, $type = 'string')
{
    switch ($type) {
        case 'domain':
            $input = preg_replace('/[^a-zA-Z0-9.-]/', '', $input);
            return strtolower(trim($input));
        case 'ip':
            $input = preg_replace('/[^a-fA-F0-9.:]/', '', $input);
            return trim($input);
        case 'email':
            return filter_var(trim($input), FILTER_SANITIZE_EMAIL);
        case 'url':
            $input = trim($input);
            if (!preg_match('/^https?:\/\//i', $input)) {
                $input = 'https://' . $input;
            }
            return filter_var($input, FILTER_SANITIZE_URL);
        case 'int':
            return (int) $input;
        case 'json':
            return json_encode($input);
        case 'html':
            return htmlspecialchars(trim($input), ENT_QUOTES, 'UTF-8');
        case 'string':
        default:
            return htmlspecialchars(trim(strip_tags($input)), ENT_QUOTES, 'UTF-8');
    }
}

/**
 * Validate domain name
 */
function cloudhost247_tools_validate_domain($domain)
{
    if (empty($domain)) return false;
    return (bool) preg_match('/^(?:[-A-Za-z0-9]+\.)+[A-Za-z]{2,}$/i', $domain);
}

/**
 * Validate IPv4 address
 */
function cloudhost247_tools_validate_ipv4($ip)
{
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
}

/**
 * Validate IPv6 address
 */
function cloudhost247_tools_validate_ipv6($ip)
{
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false;
}

/**
 * Validate IP address (v4 or v6)
 */
function cloudhost247_tools_validate_ip($ip)
{
    return filter_var($ip, FILTER_VALIDATE_IP) !== false;
}

/**
 * Validate URL
 */
function cloudhost247_tools_validate_url($url)
{
    return filter_var($url, FILTER_VALIDATE_URL) !== false;
}

/**
 * Validate email
 */
function cloudhost247_tools_validate_email($email)
{
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

/**
 * Generate CSRF token
 */
function cloudhost247_tools_generate_csrf()
{
    if (empty($_SESSION['cloudhost247_tools_csrf'])) {
        $_SESSION['cloudhost247_tools_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['cloudhost247_tools_csrf'];
}

/**
 * Verify CSRF token
 */
function cloudhost247_tools_verify_csrf($token)
{
    return isset($_SESSION['cloudhost247_tools_csrf']) && hash_equals($_SESSION['cloudhost247_tools_csrf'], $token);
}

/**
 * Check rate limit
 */
function cloudhost247_tools_check_rate_limit($ip, $maxRequests = 60)
{
    $window = 60; // 1 minute window
    $now = date('Y-m-d H:i:s');

    // Clean old entries
    Capsule::table('mod_cloudhost247_tools_rate_limit')
        ->where('window_start', '<', date('Y-m-d H:i:s', strtotime("-$window seconds")))
        ->delete();

    $record = Capsule::table('mod_cloudhost247_tools_rate_limit')
        ->where('ip_address', $ip)
        ->where('window_start', '>=', date('Y-m-d H:i:s', strtotime("-$window seconds")))
        ->first();

    if ($record) {
        if ($record->request_count >= $maxRequests) {
            return false;
        }
        Capsule::table('mod_cloudhost247_tools_rate_limit')
            ->where('id', $record->id)
            ->update([
                'request_count' => $record->request_count + 1,
            ]);
    } else {
        Capsule::table('mod_cloudhost247_tools_rate_limit')->insert([
            'ip_address' => $ip,
            'request_count' => 1,
            'window_start' => $now,
        ]);
    }

    return true;
}

/**
 * Get module setting
 */
function cloudhost247_tools_get_setting($key, $default = '')
{
    $setting = Capsule::table('tbladdonmodules')
        ->where('module', 'cloudhost247_tools')
        ->where('setting', $key)
        ->value('value');

    return $setting !== null ? $setting : $default;
}

/**
 * Log tool usage. Input payloads are truncated before persistence so huge
 * pastes (JSON viewer, email headers) cannot bloat the log table, and only
 * an admin ever sees them.
 */
function cloudhost247_tools_log($toolId, $input, $result, $status = 'success', $error = '')
{
    $enableLogs = cloudhost247_tools_get_setting('enable_logs', 'on');
    if ($enableLogs !== 'on') return;

    $userId = isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : 0;
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    if (is_array($input)) {
        unset($input['csrf_token'], $input['token']); // never persist credentials
        $input = substr((string) json_encode($input), 0, 500);
    } else {
        $input = substr((string) $input, 0, 500);
    }

    Capsule::table('mod_cloudhost247_tools_logs')->insert([
        'tool_id' => $toolId,
        'input' => $input,
        'ip_address' => $ip,
        'user_id' => $userId,
        'result' => is_array($result) ? substr((string) json_encode($result), 0, 10000) : substr((string) $result, 0, 10000),
        'status' => $status,
        'error_message' => substr((string) $error, 0, 1000),
        'created_at' => date('Y-m-d H:i:s'),
    ]);

    // Increment usage count
    Capsule::table('mod_cloudhost247_tools_status')
        ->where('tool_id', $toolId)
        ->increment('usage_count');
}

/**
 * JSON response helper
 */
function cloudhost247_tools_json_response($data, $success = true, $message = '')
{
    header('Content-Type: application/json');
    echo json_encode([
        'success' => $success,
        'message' => $message,
        'data' => $data,
    ]);
    exit;
}

/**
 * cURL helper
 *
 * TLS certificate verification is always enforced: the tools platform talks
 * to third-party APIs over HTTPS and a disabled verifier would allow a
 * man-in-the-middle to tamper with lookup results or harvest API keys.
 */
function cloudhost247_tools_curl($url, $postData = null, $headers = [], $timeout = 30)
{
    // Refuse non-HTTP(S) schemes so crafted URLs cannot reach file:// or php:// wrappers.
    if (!preg_match('~^https?://~i', $url)) {
        return ['error' => 'Unsupported URL scheme', 'code' => 0, 'body' => ''];
    }

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 4);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeout / 2);
    curl_setopt($ch, CURLOPT_USERAGENT, 'CloudHost247-Tools/2.2.7');

    if (!empty($headers)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }

    if ($postData !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
    }

    $response = curl_exec($ch);
    $error = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false) {
        return ['error' => $error, 'code' => 0, 'body' => ''];
    }

    return ['error' => '', 'code' => $httpCode, 'body' => $response];
}

/**
 * Cache helper - get
 */
function cloudhost247_tools_cache_get($key)
{
    $cache = Capsule::table('mod_cloudhost247_tools_cache')
        ->where('cache_key', $key)
        ->where('expires_at', '>', date('Y-m-d H:i:s'))
        ->first();

    if ($cache) {
        return json_decode($cache->cache_value, true);
    }
    return null;
}

/**
 * Cache helper - set
 */
function cloudhost247_tools_cache_set($key, $value, $minutes = null)
{
    if ($minutes === null) {
        $minutes = (int) cloudhost247_tools_get_setting('cache_duration', '10');
    }

    $expires = date('Y-m-d H:i:s', strtotime("+$minutes minutes"));

    Capsule::table('mod_cloudhost247_tools_cache')
        ->updateOrInsert(
            ['cache_key' => $key],
            [
                'cache_value' => json_encode($value),
                'expires_at' => $expires,
                'created_at' => date('Y-m-d H:i:s'),
            ]
        );
}

/**
 * Get client IP
 *
 * By default only the direct remote address is trusted — forwarded headers
 * (X-Forwarded-For, CF-Connecting-IP) are client-controlled and would let
 * anyone bypass rate limiting by spoofing them. Sites behind a trusted
 * proxy can opt in via the `trust_proxy_headers` module setting.
 */
function cloudhost247_tools_get_client_ip()
{
    $keys = ['REMOTE_ADDR'];
    if (cloudhost247_tools_get_setting('trust_proxy_headers', '') === 'on') {
        $keys = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'];
    }
    foreach ($keys as $key) {
        if (!empty($_SERVER[$key])) {
            $ips = explode(',', (string) $_SERVER[$key]);
            $ip = trim($ips[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
    }
    return '0.0.0.0';
}

/**
 * Get enabled tools
 */
function cloudhost247_tools_get_enabled_tools()
{
    $allTools = cloudhost247_tools_get_all_tools();
    $enabled = Capsule::table('mod_cloudhost247_tools_status')
        ->where('enabled', 1)
        ->pluck('tool_id')
        ->toArray();

    $result = [];
    foreach ($allTools as $category => $tools) {
        foreach ($tools as $toolId => $toolData) {
            if (in_array($toolId, $enabled)) {
                $result[$category][$toolId] = $toolData;
            }
        }
    }
    return $result;
}

/**
 * Get tool info
 */
function cloudhost247_tools_get_tool_info($toolId)
{
    $allTools = cloudhost247_tools_get_all_tools();
    foreach ($allTools as $category => $tools) {
        if (isset($tools[$toolId])) {
            return array_merge($tools[$toolId], ['id' => $toolId, 'category' => $category]);
        }
    }
    return null;
}

/**
 * Check if tool is enabled
 */
function cloudhost247_tools_is_tool_enabled($toolId)
{
    $status = Capsule::table('mod_cloudhost247_tools_status')
        ->where('tool_id', $toolId)
        ->value('enabled');
    return (int) $status === 1;
}

/**
 * Pretty print JSON
 */
function cloudhost247_tools_pretty_json($json)
{
    $decoded = json_decode($json);
    if (json_last_error() === JSON_ERROR_NONE) {
        return json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    }
    return $json;
}

/**
 * Convert bytes to human readable
 */
function cloudhost247_tools_bytes_to_human($bytes)
{
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $unitIndex = 0;
    while ($bytes >= 1024 && $unitIndex < count($units) - 1) {
        $bytes /= 1024;
        $unitIndex++;
    }
    return round($bytes, 2) . ' ' . $units[$unitIndex];
}

/**
 * Ping helper (socket-based for compatibility)
 */
function cloudhost247_tools_ping($host, $ipv6 = false, $count = 4, $timeout = 3)
{
    $results = [];
    $resolved = gethostbyname($host);

    if ($resolved === $host && !cloudhost247_tools_validate_ip($host)) {
        return ['error' => 'Could not resolve host'];
    }

    $ip = cloudhost247_tools_validate_ip($host) ? $host : $resolved;

    for ($i = 0; $i < $count; $i++) {
        $start = microtime(true);

        if ($ipv6) {
            $socket = @socket_create(AF_INET6, SOCK_DGRAM, SOL_UDP);
        } else {
            $socket = @socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
        }

        if (!$socket) {
            $results[] = ['seq' => $i + 1, 'status' => 'error', 'time' => null];
            continue;
        }

        socket_set_option($socket, SOL_SOCKET, SO_RCVTIMEO, ['sec' => $timeout, 'usec' => 0]);
        socket_set_option($socket, SOL_SOCKET, SO_SNDTIMEO, ['sec' => $timeout, 'usec' => 0]);

        $port = 80;
        $connected = @socket_connect($socket, $ip, $port);
        $end = microtime(true);

        if ($connected) {
            $results[] = [
                'seq' => $i + 1,
                'status' => 'success',
                'time' => round(($end - $start) * 1000, 2),
                'ip' => $ip,
            ];
            socket_close($socket);
        } else {
            $results[] = [
                'seq' => $i + 1,
                'status' => 'timeout',
                'time' => null,
                'ip' => $ip,
            ];
        }

        if ($i < $count - 1) {
            usleep(1000000); // 1 second between pings
        }
    }

    $successCount = count(array_filter($results, function ($r) {
        return $r['status'] === 'success';
    }));

    $times = array_filter(array_column($results, 'time'));
    $avg = $times ? round(array_sum($times) / count($times), 2) : 0;
    $min = $times ? min($times) : 0;
    $max = $times ? max($times) : 0;

    return [
        'host' => $host,
        'ip' => $ip,
        'packets_sent' => $count,
        'packets_received' => $successCount,
        'packet_loss' => round((($count - $successCount) / $count) * 100, 1),
        'min_time' => $min,
        'max_time' => $max,
        'avg_time' => $avg,
        'results' => $results,
    ];
}

/**
 * Traceroute helper
 */
function cloudhost247_tools_traceroute($host, $maxHops = 30, $timeout = 5)
{
    $results = [];
    $resolved = gethostbyname($host);
    $ip = cloudhost247_tools_validate_ip($host) ? $host : $resolved;

    if ($ip === $host && !cloudhost247_tools_validate_ip($host)) {
        return ['error' => 'Could not resolve host'];
    }

    for ($ttl = 1; $ttl <= $maxHops; $ttl++) {
        $start = microtime(true);
        $socket = @socket_create(AF_INET, SOCK_DGRAM, getprotobyname('udp'));
        if (!$socket) break;

        socket_set_option($socket, SOL_SOCKET, SO_RCVTIMEO, ['sec' => $timeout, 'usec' => 0]);
        socket_set_option($socket, IPPROTO_IP, IP_TTL, $ttl);

        // Send to a high port that likely won't respond
        @socket_sendto($socket, "CLOUDHOST247", 5, 0, $ip, 33434 + $ttl);

        $from = '';
        $port = 0;
        $buf = '';
        $received = @socket_recvfrom($socket, $buf, 512, 0, $from, $port);
        $end = microtime(true);

        $time = $received ? round(($end - $start) * 1000, 2) : null;
        $hostName = $from ? gethostbyaddr($from) : null;

        $results[] = [
            'hop' => $ttl,
            'ip' => $from ?: null,
            'hostname' => $hostName && $hostName !== $from ? $hostName : null,
            'time_ms' => $time,
            'status' => $from ? 'success' : 'timeout',
        ];

        socket_close($socket);

        if ($from === $ip) break;
    }

    return ['host' => $host, 'ip' => $ip, 'hops' => $results];
}

/**
 * Get DNS record with cache
 */
function cloudhost247_tools_dns_query($domain, $type = 'A')
{
    $cacheKey = 'dns_' . md5($domain . $type);
    $cached = cloudhost247_tools_cache_get($cacheKey);
    if ($cached !== null) {
        return $cached;
    }

    $records = @dns_get_record($domain, constant('DNS_' . strtoupper($type)));
    if ($records === false) {
        $records = [];
    }

    cloudhost247_tools_cache_set($cacheKey, $records);
    return $records;
}

/**
 * WHOIS lookup helper
 */
function cloudhost247_tools_whois($domain, $server = null)
{
    if (!$server) {
        $tld = substr(strrchr($domain, '.'), 1);
        $servers = [
            'com' => 'whois.verisign-grs.com',
            'net' => 'whois.verisign-grs.com',
            'org' => 'whois.pir.org',
            'info' => 'whois.afilias.info',
            'biz' => 'whois.biz',
            'io' => 'whois.nic.io',
            'co' => 'whois.nic.co',
            'uk' => 'whois.nic.uk',
            'de' => 'whois.denic.de',
            'fr' => 'whois.nic.fr',
        ];
        $server = $servers[$tld] ?? 'whois.iana.org';
    }

    $socket = @fsockopen($server, 43, $errno, $errstr, 10);
    if (!$socket) {
        return ['error' => 'Could not connect to WHOIS server'];
    }

    fwrite($socket, $domain . "\r\n");
    $response = '';
    while (!feof($socket)) {
        $response .= fgets($socket, 128);
    }
    fclose($socket);

    return ['server' => $server, 'result' => $response];
}
