<?php
/**
 * CloudHost247 Tools - Developer Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

function CloudHost247_tool_http_headers($post)
{
    $url = CloudHost247_tools_sanitize($post['url'] ?? '', 'url');
    if (!CloudHost247_tools_validate_url($url)) {
        return ['error' => 'Invalid URL'];
    }

    $result = CloudHost247_tools_curl($url, null, [], 15);
    if (!empty($result['error'])) {
        return ['error' => 'Could not fetch URL: ' . $result['error']];
    }

    $headers = [];
    if (function_exists('curl_getinfo')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HEADER, true);
        curl_setopt($ch, CURLOPT_NOBODY, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        $headerStr = curl_exec($ch);
        curl_close($ch);

        $lines = explode("\n", $headerStr);
        foreach ($lines as $line) {
            $line = trim($line);
            if (empty($line)) continue;
            if (strpos($line, 'HTTP/') === 0) {
                $headers[] = ['status' => $line];
            } elseif (strpos($line, ':') !== false) {
                list($key, $val) = explode(':', $line, 2);
                $headers[] = ['name' => trim($key), 'value' => trim($val)];
            }
        }
    }

    return [
        'url' => $url,
        'http_code' => $result['code'],
        'headers' => $headers,
    ];
}

function CloudHost247_tool_server_os_detector($post)
{
    $url = CloudHost247_tools_sanitize($post['url'] ?? '', 'url');
    if (!CloudHost247_tools_validate_url($url)) {
        return ['error' => 'Invalid URL'];
    }

    $result = CloudHost247_tools_curl($url, null, [], 15);
    $os = 'Unknown';
    $server = 'Unknown';

    if ($result['code'] > 0) {
        preg_match('/Server:\s*([^\r\n]+)/i', $result['body'], $serverMatch);
        if ($serverMatch) {
            $server = trim($serverMatch[1]);
            if (stripos($server, 'win') !== false) $os = 'Windows';
            elseif (stripos($server, 'apache') !== false) $os = 'Linux/Unix';
            elseif (stripos($server, 'nginx') !== false) $os = 'Linux/Unix';
            elseif (stripos($server, 'iis') !== false) $os = 'Windows';
        }

        // Try more headers
        $headers = CloudHost247_tool_http_headers(['url' => $url]);
        if (isset($headers['headers'])) {
            foreach ($headers['headers'] as $h) {
                if (isset($h['name'])) {
                    if (strtolower($h['name']) === 'x-powered-by') {
                        if (stripos($h['value'], 'win') !== false) $os = 'Windows';
                    }
                }
            }
        }
    }

    return ['url' => $url, 'server' => $server, 'os_guess' => $os];
}

function CloudHost247_tool_md5_base64($post)
{
    $input = $_POST['input'] ?? '';
    $mode = CloudHost247_tools_sanitize($post['mode'] ?? 'md5', 'string');

    if (empty($input)) {
        return ['error' => 'Please enter text to hash'];
    }

    switch ($mode) {
        case 'md5':
            return ['input' => $input, 'md5' => md5($input), 'type' => 'MD5'];
        case 'sha1':
            return ['input' => $input, 'sha1' => sha1($input), 'type' => 'SHA1'];
        case 'sha256':
            return ['input' => $input, 'sha256' => hash('sha256', $input), 'type' => 'SHA256'];
        case 'base64_encode':
            return ['input' => $input, 'base64' => base64_encode($input), 'type' => 'Base64 Encode'];
        case 'base64_decode':
            $decoded = base64_decode($input, true);
            if ($decoded === false) {
                return ['error' => 'Invalid Base64 string'];
            }
            return ['input' => $input, 'decoded' => $decoded, 'type' => 'Base64 Decode'];
        default:
            return ['error' => 'Unknown mode'];
    }
}

function CloudHost247_tool_multi_url_opener($post)
{
    $urls = $_POST['urls'] ?? '';
    $lines = array_filter(array_map('trim', explode("\n", $urls)));
    $validUrls = [];

    foreach ($lines as $line) {
        $url = CloudHost247_tools_sanitize($line, 'url');
        if (CloudHost247_tools_validate_url($url)) {
            $validUrls[] = $url;
        }
    }

    return ['urls' => $validUrls, 'count' => count($validUrls)];
}

function CloudHost247_tool_smtp_test($post)
{
    $host = CloudHost247_tools_sanitize($post['host'] ?? '', 'domain');
    $port = (int) ($post['port'] ?? 25);
    $timeout = 10;

    if (empty($host)) {
        return ['error' => 'Please enter SMTP server address'];
    }

    $socket = @fsockopen($host, $port, $errno, $errstr, $timeout);
    if (!$socket) {
        return ['host' => $host, 'port' => $port, 'reachable' => false, 'error' => $errstr];
    }

    $banner = fgets($socket, 512);
    fputs($socket, "QUIT\r\n");
    fclose($socket);

    return [
        'host' => $host,
        'port' => $port,
        'reachable' => true,
        'banner' => trim($banner),
    ];
}

function CloudHost247_tool_htaccess_generator($post)
{
    $type = CloudHost247_tools_sanitize($post['redirect_type'] ?? '301', 'string');
    $from = CloudHost247_tools_sanitize($post['from'] ?? '', 'string');
    $to = CloudHost247_tools_sanitize($post['to'] ?? '', 'string');

    if (empty($from) || empty($to)) {
        return ['error' => 'Please enter both from and to URLs'];
    }

    $code = "RewriteEngine On\n";
    $code .= "RewriteRule ^" . ltrim($from, '/') . "$ " . $to . " [R=" . $type . ",L]";

    $alt = "Redirect " . $type . " " . $from . " " . $to;

    return [
        'rewrite_rule' => $code,
        'redirect_directive' => $alt,
        'type' => $type,
    ];
}

function CloudHost247_tool_url_rewrite($post)
{
    // Alias to htaccess generator
    return CloudHost247_tool_htaccess_generator($post);
}

function CloudHost247_tool_broken_link_checker($post)
{
    $url = CloudHost247_tools_sanitize($post['url'] ?? '', 'url');
    if (!CloudHost247_tools_validate_url($url)) {
        return ['error' => 'Invalid URL'];
    }

    $result = CloudHost247_tools_curl($url, null, [], 20);
    if (empty($result['body'])) {
        return ['error' => 'Could not fetch page'];
    }

    // Extract links
    preg_match_all('/href=["\']([^"\']+)["\']/i', $result['body'], $matches);
    $links = array_unique($matches[1]);
    $checked = [];
    $broken = 0;

    $maxCheck = min(count($links), 20); // Limit to 20 links
    foreach (array_slice($links, 0, $maxCheck) as $link) {
        if (strpos($link, '#') === 0 || strpos($link, 'javascript:') === 0 || strpos($link, 'mailto:') === 0) continue;
        if (strpos($link, 'http') !== 0) {
            $parsed = parse_url($url);
            $base = $parsed['scheme'] . '://' . $parsed['host'];
            $link = $base . (strpos($link, '/') === 0 ? '' : '/') . $link;
        }

        $res = CloudHost247_tools_curl($link, null, [], 10);
        $ok = $res['code'] >= 200 && $res['code'] < 400;
        if (!$ok) $broken++;
        $checked[] = ['url' => $link, 'status' => $res['code'], 'ok' => $ok];
    }

    return [
        'checked' => count($checked),
        'broken' => $broken,
        'links' => $checked,
    ];
}

function CloudHost247_tool_open_graph($post)
{
    $title = CloudHost247_tools_sanitize($post['title'] ?? '', 'string');
    $description = CloudHost247_tools_sanitize($post['description'] ?? '', 'string');
    $url = CloudHost247_tools_sanitize($post['url'] ?? '', 'url');
    $image = CloudHost247_tools_sanitize($post['image'] ?? '', 'url');
    $type = CloudHost247_tools_sanitize($post['type'] ?? 'website', 'string');

    $tags = "<!-- Open Graph / Facebook -->\n";
    if ($title) $tags .= '<meta property="og:title" content="' . htmlspecialchars($title) . '" />' . "\n";
    if ($description) $tags .= '<meta property="og:description" content="' . htmlspecialchars($description) . '" />' . "\n";
    if ($url) $tags .= '<meta property="og:url" content="' . htmlspecialchars($url) . '" />' . "\n";
    if ($image) $tags .= '<meta property="og:image" content="' . htmlspecialchars($image) . '" />' . "\n";
    $tags .= '<meta property="og:type" content="' . htmlspecialchars($type) . '" />' . "\n\n";

    $tags .= "<!-- Twitter -->\n";
    if ($title) $tags .= '<meta property="twitter:title" content="' . htmlspecialchars($title) . '" />' . "\n";
    if ($description) $tags .= '<meta property="twitter:description" content="' . htmlspecialchars($description) . '" />' . "\n";
    if ($url) $tags .= '<meta property="twitter:url" content="' . htmlspecialchars($url) . '" />' . "\n";
    if ($image) $tags .= '<meta property="twitter:image" content="' . htmlspecialchars($image) . '" />' . "\n";

    return ['tags' => $tags, 'preview_title' => $title, 'preview_desc' => $description];
}

function CloudHost247_tool_raid_calculator($post)
{
    $drives = (int) ($post['drives'] ?? 2);
    $size = (float) ($post['size'] ?? 1000); // GB
    $raid = (int) ($post['raid'] ?? 1);

    $usable = 0;
    $faultTolerance = 0;

    switch ($raid) {
        case 0:
            $usable = $drives * $size;
            $faultTolerance = 0;
            break;
        case 1:
            $usable = $size;
            $faultTolerance = $drives - 1;
            break;
        case 5:
            $usable = ($drives - 1) * $size;
            $faultTolerance = 1;
            break;
        case 6:
            $usable = ($drives - 2) * $size;
            $faultTolerance = 2;
            break;
        case 10:
            $usable = ($drives / 2) * $size;
            $faultTolerance = $drives / 2;
            break;
        default:
            return ['error' => 'Unsupported RAID level'];
    }

    return [
        'drives' => $drives,
        'drive_size_gb' => $size,
        'raid_level' => $raid,
        'usable_capacity_gb' => round($usable, 2),
        'fault_tolerance' => $faultTolerance,
        'efficiency' => round(($usable / ($drives * $size)) * 100, 1),
    ];
}

function CloudHost247_tool_binary_text($post)
{
    $input = $_POST['input'] ?? '';
    $mode = CloudHost247_tools_sanitize($post['mode'] ?? 'text_to_binary', 'string');

    if (empty($input)) {
        return ['error' => 'Please enter input'];
    }

    if ($mode === 'text_to_binary') {
        $binary = '';
        for ($i = 0; $i < strlen($input); $i++) {
            $binary .= str_pad(decbin(ord($input[$i])), 8, '0', STR_PAD_LEFT) . ' ';
        }
        return ['input' => $input, 'output' => trim($binary), 'mode' => 'Text to Binary'];
    } elseif ($mode === 'binary_to_text') {
        $bytes = explode(' ', trim($input));
        $text = '';
        foreach ($bytes as $byte) {
            if (preg_match('/^[01]{1,8}$/', $byte)) {
                $text .= chr(bindec($byte));
            }
        }
        return ['input' => $input, 'output' => $text, 'mode' => 'Binary to Text'];
    } elseif ($mode === 'text_to_hex') {
        return ['input' => $input, 'output' => bin2hex($input), 'mode' => 'Text to Hex'];
    } elseif ($mode === 'hex_to_text') {
        $text = @hex2bin(preg_replace('/[^a-fA-F0-9]/', '', $input));
        if ($text === false) {
            return ['error' => 'Invalid hex string'];
        }
        return ['input' => $input, 'output' => $text, 'mode' => 'Hex to Text'];
    }

    return ['error' => 'Unknown conversion mode'];
}

function CloudHost247_tool_json_formatter($post)
{
    $input = $_POST['json'] ?? '';
    $mode = CloudHost247_tools_sanitize($post['mode'] ?? 'format', 'string');

    if (empty($input)) {
        return ['error' => 'Please enter JSON'];
    }

    $decoded = json_decode($input);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return ['error' => 'Invalid JSON: ' . json_last_error_msg()];
    }

    if ($mode === 'format') {
        return ['formatted' => json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), 'valid' => true];
    } elseif ($mode === 'minify') {
        return ['formatted' => json_encode($decoded), 'valid' => true];
    } elseif ($mode === 'tree') {
        return ['tree' => print_r($decoded, true), 'valid' => true];
    }

    return ['formatted' => json_encode($decoded, JSON_PRETTY_PRINT), 'valid' => true];
}
