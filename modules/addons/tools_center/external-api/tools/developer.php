<?php
/**
 * Developer Tools Module
 * HTTP headers, OS checker, MD5/Base64, URL opener, SMTP test, htaccess, and more
 */

class DeveloperTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * HTTP Headers Check
     */
    public function httpHeadersCheck($params) {
        $url = $params['url'] ?? '';
        
        if (empty($url)) {
            throw new Exception('URL is required');
        }
        
        if (!preg_match('/^https?:\/\//i', $url)) {
            $url = 'https://' . $url;
        }
        
        $url = filter_var($url, FILTER_VALIDATE_URL);
        if (!$url) {
            throw new Exception('Invalid URL');
        }
        
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_NOBODY => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        ]);
        
        $response = curl_exec($ch);
        $info = curl_getinfo($ch);
        curl_close($ch);
        
        if ($response === false) {
            throw new Exception('Failed to fetch URL');
        }
        
        // Parse headers
        $headers = [];
        $lines = explode("\r\n", $response);
        $statusLine = array_shift($lines);
        
        foreach ($lines as $line) {
            if (strpos($line, ':') !== false) {
                list($key, $value) = explode(':', $line, 2);
                $headers[trim($key)] = trim($value);
            }
        }
        
        // Security headers analysis
        $securityHeaders = [
            'Strict-Transport-Security' => ['name' => 'HSTS', 'recommended' => true],
            'Content-Security-Policy' => ['name' => 'CSP', 'recommended' => true],
            'X-Frame-Options' => ['name' => 'Clickjacking Protection', 'recommended' => true],
            'X-Content-Type-Options' => ['name' => 'MIME Sniffing Protection', 'recommended' => true],
            'Referrer-Policy' => ['name' => 'Referrer Policy', 'recommended' => true],
            'Permissions-Policy' => ['name' => 'Permissions Policy', 'recommended' => false],
            'X-XSS-Protection' => ['name' => 'XSS Filter', 'recommended' => false],
        ];
        
        $securityAnalysis = [];
        foreach ($securityHeaders as $header => $data) {
            $present = isset($headers[$header]);
            $securityAnalysis[] = [
                'header' => $header,
                'name' => $data['name'],
                'present' => $present,
                'value' => $headers[$header] ?? null,
                'recommended' => $data['recommended'],
                'status' => $present ? 'OK' : ($data['recommended'] ? 'MISSING' : 'INFO')
            ];
        }
        
        $presentSecurity = count(array_filter($securityAnalysis, function($h) { return $h['present'] && $h['recommended']; }));
        $totalSecurity = count(array_filter($securityAnalysis, function($h) { return $h['recommended']; }));
        
        return [
            'url' => $url,
            'status_code' => $info['http_code'],
            'response_time_ms' => round($info['total_time'] * 1000, 2),
            'content_type' => $headers['Content-Type'] ?? 'Unknown',
            'server' => $headers['Server'] ?? 'Unknown',
            'headers' => $headers,
            'security_analysis' => $securityAnalysis,
            'security_score' => round(($presentSecurity / max(1, $totalSecurity)) * 100),
            'redirects' => $info['redirect_count'] ?? 0,
            'final_url' => $info['url'] ?? $url,
        ];
    }
    
    /**
     * Website OS Checker
     */
    public function websiteOSChecker($params) {
        $url = $params['url'] ?? '';
        
        if (empty($url)) {
            throw new Exception('URL is required');
        }
        
        if (!preg_match('/^https?:\/\//i', $url)) {
            $url = 'https://' . $url;
        }
        
        $host = parse_url($url, PHP_URL_HOST);
        
        // Check Server header
        $headers = $this->httpHeadersCheck(['url' => $url]);
        $server = $headers['headers']['Server'] ?? '';
        $os = 'Unknown';
        $webserver = 'Unknown';
        $technology = [];
        
        if (stripos($server, 'Apache') !== false) {
            $webserver = 'Apache';
            preg_match('/Apache\/(\d+\.\d+)/', $server, $m);
            $version = $m[1] ?? 'Unknown';
            $technology[] = "Apache {$version}";
            
            if (stripos($server, 'Unix') !== false || stripos($server, 'Linux') !== false) {
                $os = 'Linux/Unix';
            } elseif (stripos($server, 'Win') !== false) {
                $os = 'Windows';
            }
        } elseif (stripos($server, 'nginx') !== false) {
            $webserver = 'Nginx';
            preg_match('/nginx\/(\d+\.\d+)/', $server, $m);
            $version = $m[1] ?? 'Unknown';
            $technology[] = "Nginx {$version}";
            $os = 'Linux/Unix';
        } elseif (stripos($server, 'Microsoft-IIS') !== false) {
            $webserver = 'IIS';
            preg_match('/IIS\/(\d+\.\d+)/', $server, $m);
            $version = $m[1] ?? 'Unknown';
            $technology[] = "IIS {$version}";
            $os = 'Windows';
        } elseif (stripos($server, 'cloudflare') !== false) {
            $technology[] = 'Cloudflare';
        }
        
        // Check X-Powered-By
        if (isset($headers['headers']['X-Powered-By'])) {
            $powered = $headers['headers']['X-Powered-By'];
            if (stripos($powered, 'PHP') !== false) {
                $technology[] = $powered;
            }
            if (stripos($powered, 'ASP.NET') !== false) {
                $technology[] = $powered;
                $os = 'Windows';
            }
        }
        
        // Check for common technologies
        $responseHeaders = $headers['headers'];
        if (isset($responseHeaders['X-Generator'])) {
            $technology[] = $responseHeaders['X-Generator'];
        }
        if (isset($responseHeaders['CF-Cache-Status'])) {
            $technology[] = 'Cloudflare CDN';
        }
        
        return [
            'url' => $url,
            'detected_os' => $os,
            'web_server' => $webserver,
            'server_header' => $server,
            'technologies' => $technology,
            'confidence' => $os !== 'Unknown' ? 'Medium' : 'Low',
            'all_headers' => $responseHeaders,
        ];
    }
    
    /**
     * MD5 & Base64 Generator
     */
    public function hashGenerator($params) {
        $text = $params['text'] ?? '';
        
        if (empty($text)) {
            throw new Exception('Text is required');
        }
        
        if (strlen($text) > 10000) {
            throw new Exception('Text too long (max 10,000 characters)');
        }
        
        return [
            'input' => $text,
            'input_length' => strlen($text),
            'md5' => md5($text),
            'sha1' => sha1($text),
            'sha256' => hash('sha256', $text),
            'sha512' => hash('sha512', $text),
            'base64_encode' => base64_encode($text),
            'base64_decode' => base64_decode($text, true) !== false ? base64_decode($text) : 'Invalid Base64',
            'crc32' => hash('crc32', $text),
            'crc32b' => hash('crc32b', $text),
            'whirlpool' => hash('whirlpool', $text),
        ];
    }
    
    /**
     * Multi URL Opener
     */
    public function multiUrlOpener($params) {
        $urls = $params['urls'] ?? '';
        
        if (empty($urls)) {
            throw new Exception('URLs are required');
        }
        
        $urlList = preg_split('/[\r\n,]+/', $urls, -1, PREG_SPLIT_NO_EMPTY);
        $urlList = array_map('trim', $urlList);
        $urlList = array_slice($urlList, 0, 50); // Limit to 50 URLs
        
        $results = [];
        foreach ($urlList as $url) {
            if (!preg_match('/^https?:\/\//i', $url)) {
                $url = 'https://' . $url;
            }
            
            $valid = filter_var($url, FILTER_VALIDATE_URL) !== false;
            
            $results[] = [
                'original' => $url,
                'url' => $valid ? $url : null,
                'valid' => $valid,
                'error' => $valid ? null : 'Invalid URL format'
            ];
        }
        
        return [
            'urls' => $results,
            'total' => count($results),
            'valid' => count(array_filter($results, function($u) { return $u['valid']; })),
        ];
    }
    
    /**
     * SMTP Test Tool
     */
    public function smtpTest($params) {
        $host = $params['host'] ?? '';
        $port = (int)($params['port'] ?? 25);
        $timeout = min((int)($params['timeout'] ?? 10), 30);
        
        if (empty($host)) {
            throw new Exception('SMTP host is required');
        }
        
        $host = $this->sanitizeHost($host);
        
        $commonPorts = [25, 587, 465, 2525];
        $testPorts = in_array($port, $commonPorts) ? [$port] : array_merge([$port], $commonPorts);
        
        $results = [];
        
        foreach (array_unique($testPorts) as $testPort) {
            $startTime = microtime(true);
            $socket = @fsockopen($host, $testPort, $errno, $errstr, $timeout);
            $connectTime = round((microtime(true) - $startTime) * 1000, 2);
            
            if ($socket) {
                $banner = fgets($socket, 1024);
                fclose($socket);
                
                $results[] = [
                    'port' => $testPort,
                    'open' => true,
                    'connect_time_ms' => $connectTime,
                    'banner' => trim($banner),
                    'service' => $this->getSMTPServiceName($testPort),
                    'tls' => in_array($testPort, [465, 587])
                ];
            } else {
                $results[] = [
                    'port' => $testPort,
                    'open' => false,
                    'connect_time_ms' => $connectTime,
                    'error' => $errstr ?: 'Connection refused',
                    'service' => $this->getSMTPServiceName($testPort),
                    'tls' => in_array($testPort, [465, 587])
                ];
            }
        }
        
        return [
            'host' => $host,
            'ports_tested' => $results,
            'reachable' => count(array_filter($results, function($r) { return $r['open']; })) > 0,
            'recommended_port' => $results[0]['port'] ?? null,
        ];
    }
    
    /**
     * htaccess Redirect Generator
     */
    public function htaccessRedirectGenerator($params) {
        $type = $params['type'] ?? '301';
        $from = $params['from'] ?? '';
        $to = $params['to'] ?? '';
        $www = $params['www'] ?? '';
        $https = $params['https'] ?? '';
        
        $rules = [];
        $rules[] = '# Generated by WHMCS Tools Center';
        $rules[] = 'RewriteEngine On';
        $rules[] = '';
        
        // Redirect www or non-www
        if ($www === 'non-www') {
            $rules[] = '# Redirect www to non-www';
            $rules[] = 'RewriteCond %{HTTP_HOST} ^www\\.(.*)$ [NC]';
            $rules[] = 'RewriteRule ^(.*)$ https://%1/$1 [R=301,L]';
            $rules[] = '';
        } elseif ($www === 'www') {
            $rules[] = '# Redirect non-www to www';
            $rules[] = 'RewriteCond %{HTTP_HOST} !^www\\. [NC]';
            $rules[] = 'RewriteRule ^(.*)$ https://www.%{HTTP_HOST}/$1 [R=301,L]';
            $rules[] = '';
        }
        
        // HTTPS redirect
        if ($https === 'force') {
            $rules[] = '# Force HTTPS';
            $rules[] = 'RewriteCond %{HTTPS} off';
            $rules[] = 'RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]';
            $rules[] = '';
        }
        
        // Specific redirect
        if (!empty($from) && !empty($to)) {
            $rules[] = '# Redirect ' . $from . ' to ' . $to;
            if ($type === '301') {
                $rules[] = 'Redirect 301 ' . $from . ' ' . $to;
            } elseif ($type === '302') {
                $rules[] = 'Redirect 302 ' . $from . ' ' . $to;
            } elseif ($type === 'rewrite') {
                $rules[] = 'RewriteRule ^' . ltrim($from, '/') . '$ ' . $to . ' [R=301,L]';
            }
        }
        
        $htaccess = implode("\n", $rules);
        
        return [
            'type' => $type,
            'htaccess_content' => $htaccess,
            'lines' => count($rules),
        ];
    }
    
    /**
     * URL Rewrite Generator
     */
    public function urlRewriteGenerator($params) {
        $source = $params['source'] ?? '';
        $target = $params['target'] ?? '';
        $type = $params['type'] ?? 'apache';
        
        if (empty($source) || empty($target)) {
            throw new Exception('Source and target are required');
        }
        
        $rewrite = '';
        
        if ($type === 'apache') {
            $rewrite = "RewriteEngine On\n";
            $rewrite .= "RewriteRule ^" . preg_quote(ltrim($source, '/'), '/') . "\$ " . $target . " [R=301,L]";
        } elseif ($type === 'nginx') {
            $rewrite = "rewrite ^" . preg_quote($source, '/') . "\$ " . $target . " permanent;";
        } elseif ($type === 'iis') {
            $rewrite = "<rule name=\"Redirect\" stopProcessing=\"true\">\n";
            $rewrite .= "  <match url=\"^" . preg_quote(ltrim($source, '/'), '/') . "\$\" />\n";
            $rewrite .= "  <action type=\"Redirect\" url=\"" . $target . "\" redirectType=\"Permanent\" />\n";
            $rewrite .= "</rule>";
        }
        
        return [
            'source' => $source,
            'target' => $target,
            'server_type' => $type,
            'rewrite_rule' => $rewrite,
        ];
    }
    
    /**
     * Broken Links Checker
     */
    public function brokenLinksChecker($params) {
        $url = $params['url'] ?? '';
        $depth = min((int)($params['depth'] ?? 1), 2);
        
        if (empty($url)) {
            throw new Exception('URL is required');
        }
        
        if (!preg_match('/^https?:\/\//i', $url)) {
            $url = 'https://' . $url;
        }
        
        $valid = filter_var($url, FILTER_VALIDATE_URL);
        if (!$valid) {
            throw new Exception('Invalid URL');
        }
        
        // Fetch page content
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; WHMCS-Tools-Center/1.0; +https://example.com)'
        ]);
        
        $html = curl_exec($ch);
        $info = curl_getinfo($ch);
        curl_close($ch);
        
        if ($html === false) {
            throw new Exception('Failed to fetch page');
        }
        
        // Extract links
        $links = [];
        preg_match_all('/href=["\']([^"\']+)["\']/i', $html, $matches);
        
        $baseHost = parse_url($url, PHP_URL_HOST);
        $foundUrls = array_slice(array_unique($matches[1]), 0, 50);
        
        $results = [];
        foreach ($foundUrls as $link) {
            if (strpos($link, '#') === 0 || strpos($link, 'mailto:') === 0 || strpos($link, 'javascript:') === 0) {
                continue;
            }
            
            if (strpos($link, 'http') !== 0) {
                $link = rtrim($url, '/') . '/' . ltrim($link, '/');
            }
            
            $linkHost = parse_url($link, PHP_URL_HOST);
            $isInternal = $linkHost === $baseHost;
            
            // Check link
            $linkCh = curl_init($link);
            curl_setopt_array($linkCh, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_NOBODY => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; WHMCS-Tools-Center/1.0)'
            ]);
            
            curl_exec($linkCh);
            $linkInfo = curl_getinfo($linkCh);
            curl_close($linkCh);
            
            $statusCode = $linkInfo['http_code'];
            $broken = $statusCode === 0 || $statusCode >= 400;
            
            $results[] = [
                'url' => $link,
                'status_code' => $statusCode,
                'broken' => $broken,
                'internal' => $isInternal,
                'redirects' => $linkInfo['redirect_count'] ?? 0,
                'response_time_ms' => round($linkInfo['total_time'] * 1000, 2)
            ];
        }
        
        $brokenCount = count(array_filter($results, function($r) { return $r['broken']; }));
        
        return [
            'url' => $url,
            'links_checked' => count($results),
            'broken_count' => $brokenCount,
            'healthy_count' => count($results) - $brokenCount,
            'links' => $results,
            'health_score' => count($results) > 0 ? round((1 - $brokenCount / count($results)) * 100) : 0,
        ];
    }
    
    /**
     * Open Graph Generator
     */
    public function openGraphGenerator($params) {
        $title = $params['title'] ?? '';
        $description = $params['description'] ?? '';
        $url = $params['url'] ?? '';
        $image = $params['image'] ?? '';
        $siteName = $params['site_name'] ?? '';
        $type = $params['type'] ?? 'website';
        $locale = $params['locale'] ?? 'en_US';
        
        if (empty($title) || empty($url)) {
            throw new Exception('Title and URL are required');
        }
        
        $ogTags = [];
        $ogTags[] = '<meta property="og:title" content="' . htmlspecialchars($title, ENT_QUOTES) . '" />';
        $ogTags[] = '<meta property="og:type" content="' . htmlspecialchars($type, ENT_QUOTES) . '" />';
        $ogTags[] = '<meta property="og:url" content="' . htmlspecialchars($url, ENT_QUOTES) . '" />';
        
        if (!empty($description)) {
            $ogTags[] = '<meta property="og:description" content="' . htmlspecialchars($description, ENT_QUOTES) . '" />';
        }
        
        if (!empty($image)) {
            $ogTags[] = '<meta property="og:image" content="' . htmlspecialchars($image, ENT_QUOTES) . '" />';
        }
        
        if (!empty($siteName)) {
            $ogTags[] = '<meta property="og:site_name" content="' . htmlspecialchars($siteName, ENT_QUOTES) . '" />';
        }
        
        $ogTags[] = '<meta property="og:locale" content="' . htmlspecialchars($locale, ENT_QUOTES) . '" />';
        
        // Twitter Card tags
        $twitterTags = [];
        $twitterTags[] = '<meta name="twitter:card" content="summary_large_image" />';
        $twitterTags[] = '<meta name="twitter:title" content="' . htmlspecialchars($title, ENT_QUOTES) . '" />';
        
        if (!empty($description)) {
            $twitterTags[] = '<meta name="twitter:description" content="' . htmlspecialchars($description, ENT_QUOTES) . '" />';
        }
        
        if (!empty($image)) {
            $twitterTags[] = '<meta name="twitter:image" content="' . htmlspecialchars($image, ENT_QUOTES) . '" />';
        }
        
        return [
            'title' => $title,
            'og_tags' => implode("\n", $ogTags),
            'twitter_tags' => implode("\n", $twitterTags),
            'all_meta_tags' => implode("\n", array_merge($ogTags, $twitterTags)),
            'tag_count' => count($ogTags) + count($twitterTags),
        ];
    }
    
    /**
     * RAID Calculator
     */
    public function raidCalculator($params) {
        $type = strtoupper($params['type'] ?? 'RAID1');
        $drives = (int)($params['drives'] ?? 2);
        $driveSize = (float)($params['drive_size'] ?? 1000); // GB
        $driveUnit = strtolower($params['drive_unit'] ?? 'gb');
        
        // Convert to GB
        switch ($driveUnit) {
            case 'tb': $driveSize *= 1000; break;
            case 'mb': $driveSize /= 1000; break;
        }
        
        $raidTypes = [
            'RAID0' => ['min_drives' => 2, 'fault_tolerance' => 0, 'read_speed' => 'High', 'write_speed' => 'High'],
            'RAID1' => ['min_drives' => 2, 'fault_tolerance' => 1, 'read_speed' => 'High', 'write_speed' => 'Medium'],
            'RAID5' => ['min_drives' => 3, 'fault_tolerance' => 1, 'read_speed' => 'High', 'write_speed' => 'Medium'],
            'RAID6' => ['min_drives' => 4, 'fault_tolerance' => 2, 'read_speed' => 'High', 'write_speed' => 'Low'],
            'RAID10' => ['min_drives' => 4, 'fault_tolerance' => 2, 'read_speed' => 'Very High', 'write_speed' => 'High'],
        ];
        
        if (!isset($raidTypes[$type])) {
            throw new Exception('Invalid RAID type. Use: RAID0, RAID1, RAID5, RAID6, RAID10');
        }
        
        $config = $raidTypes[$type];
        
        if ($drives < $config['min_drives']) {
            throw new Exception("RAID {$type} requires minimum {$config['min_drives']} drives");
        }
        
        $totalCapacity = 0;
        $usableCapacity = 0;
        
        switch ($type) {
            case 'RAID0':
                $totalCapacity = $drives * $driveSize;
                $usableCapacity = $totalCapacity;
                break;
            case 'RAID1':
                $totalCapacity = $drives * $driveSize;
                $usableCapacity = $driveSize;
                break;
            case 'RAID5':
                $totalCapacity = $drives * $driveSize;
                $usableCapacity = ($drives - 1) * $driveSize;
                break;
            case 'RAID6':
                $totalCapacity = $drives * $driveSize;
                $usableCapacity = ($drives - 2) * $driveSize;
                break;
            case 'RAID10':
                $totalCapacity = $drives * $driveSize;
                $usableCapacity = ($drives / 2) * $driveSize;
                break;
        }
        
        return [
            'raid_type' => $type,
            'drives' => $drives,
            'drive_size_gb' => round($driveSize, 2),
            'total_capacity_gb' => round($totalCapacity, 2),
            'usable_capacity_gb' => round($usableCapacity, 2),
            'capacity_loss_gb' => round($totalCapacity - $usableCapacity, 2),
            'efficiency' => round(($usableCapacity / $totalCapacity) * 100, 2) . '%',
            'fault_tolerance' => $config['fault_tolerance'],
            'min_drives' => $config['min_drives'],
            'read_performance' => $config['read_speed'],
            'write_performance' => $config['write_speed'],
        ];
    }
    
    /**
     * Binary Text Converter
     */
    public function binaryTextConverter($params) {
        $text = $params['text'] ?? '';
        $mode = $params['mode'] ?? 'auto'; // auto, text_to_binary, binary_to_text
        
        if (empty($text)) {
            throw new Exception('Text is required');
        }
        
        if (strlen($text) > 10000) {
            throw new Exception('Text too long (max 10,000 characters)');
        }
        
        // Detect if input is binary
        $isBinary = preg_match('/^[01\s]+$/', $text) && (strlen(str_replace(' ', '', $text)) % 8 === 0);
        
        if (($mode === 'auto' && $isBinary) || $mode === 'binary_to_text') {
            // Binary to text
            $binary = str_replace(' ', '', $text);
            $chars = str_split($binary, 8);
            $result = '';
            foreach ($chars as $char) {
                if (strlen($char) === 8) {
                    $result .= chr(bindec($char));
                }
            }
            
            return [
                'input' => $text,
                'mode' => 'binary_to_text',
                'output' => $result,
                'input_type' => 'Binary',
                'output_type' => 'Text',
            ];
        } else {
            // Text to binary
            $result = '';
            for ($i = 0; $i < strlen($text); $i++) {
                $result .= str_pad(decbin(ord($text[$i])), 8, '0', STR_PAD_LEFT) . ' ';
            }
            
            return [
                'input' => $text,
                'mode' => 'text_to_binary',
                'output' => trim($result),
                'input_type' => 'Text',
                'output_type' => 'Binary',
            ];
        }
    }
    
    /**
     * JSON Viewer / Beautifier / Minifier
     */
    public function jsonTool($params) {
        $json = $params['json'] ?? '';
        $action = $params['action'] ?? 'beautify'; // beautify, minify, validate
        
        if (empty($json)) {
            throw new Exception('JSON is required');
        }
        
        // Decode JSON
        $decoded = json_decode($json, true);
        $lastError = json_last_error();
        
        if ($lastError !== JSON_ERROR_NONE) {
            $errors = [
                JSON_ERROR_DEPTH => 'Maximum stack depth exceeded',
                JSON_ERROR_STATE_MISMATCH => 'Underflow or the modes mismatch',
                JSON_ERROR_CTRL_CHAR => 'Unexpected control character found',
                JSON_ERROR_SYNTAX => 'Syntax error, malformed JSON',
                JSON_ERROR_UTF8 => 'Malformed UTF-8 characters',
            ];
            
            throw new Exception('Invalid JSON: ' . ($errors[$lastError] ?? 'Unknown error'));
        }
        
        $result = [];
        
        if ($action === 'validate') {
            $result = [
                'valid' => true,
                'type' => is_array($decoded) && array_keys($decoded) !== range(0, count($decoded) - 1) ? 'Object' : 'Array',
                'keys' => is_array($decoded) ? array_keys($decoded) : [],
                'depth' => $this->getJsonDepth($decoded),
            ];
        } elseif ($action === 'minify') {
            $result = [
                'output' => json_encode($decoded),
                'original_size' => strlen($json),
                'minified_size' => strlen(json_encode($decoded)),
                'savings' => strlen($json) - strlen(json_encode($decoded)),
            ];
        } else {
            // beautify
            $pretty = json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $result = [
                'output' => $pretty,
                'original_size' => strlen($json),
                'beautified_size' => strlen($pretty),
            ];
        }
        
        $result['valid'] = true;
        return $result;
    }
    
    private function getJsonDepth($data) {
        $depth = 0;
        if (is_array($data)) {
            foreach ($data as $value) {
                if (is_array($value)) {
                    $depth = max($depth, 1 + $this->getJsonDepth($value));
                }
            }
        }
        return $depth;
    }
    
    private function getSMTPServiceName($port) {
        $services = [
            25 => 'SMTP',
            587 => 'SMTP (Submission)',
            465 => 'SMTPS (SSL)',
            2525 => 'SMTP (Alternative)',
        ];
        return $services[$port] ?? 'Unknown';
    }
    
    private function sanitizeHost($host) {
        $host = strtolower(trim($host));
        $host = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $host);
        $host = preg_replace('/\/.*$/', '', $host);
        return preg_replace('/[^a-z0-9.\-]/', '', $host);
    }
}