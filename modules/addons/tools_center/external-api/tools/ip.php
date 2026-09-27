<?php
/**
 * IP Tools Module
 * Ping, traceroute, geolocation, conversions, subnet calculation, and more
 */

class IpTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * Ping IPv4/IPv6
     */
    public function ping($params) {
        $host = $params['host'] ?? '';
        $count = min((int)($params['count'] ?? 4), 10);
        $timeout = min((int)($params['timeout'] ?? 5), 30);
        
        if (empty($host)) {
            throw new Exception('Host is required');
        }
        
        // Sanitize host
        $host = $this->sanitizeHost($host);
        
        if (!$this->isValidHostOrIP($host)) {
            throw new Exception('Invalid host or IP address');
        }
        
        // Determine ping command based on OS and IP version
        $isIPv6 = filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
        $os = strtoupper(substr(PHP_OS, 0, 3));
        
        if ($os === 'WIN') {
            $cmd = $isIPv6 
                ? sprintf('ping -6 -n %d -w %d %s', $count, $timeout * 1000, escapeshellarg($host))
                : sprintf('ping -n %d -w %d %s', $count, $timeout * 1000, escapeshellarg($host));
        } else {
            $cmd = $isIPv6
                ? sprintf('ping6 -c %d -W %d %s 2>/dev/null', $count, $timeout, escapeshellarg($host))
                : sprintf('ping -c %d -W %d %s 2>/dev/null', $count, $timeout, escapeshellarg($host));
        }
        
        $output = [];
        $returnCode = 0;
        exec($cmd, $output, $returnCode);
        
        $transmitted = 0;
        $received = 0;
        $minTime = null;
        $avgTime = null;
        $maxTime = null;
        $packets = [];
        
        foreach ($output as $line) {
            if (preg_match('/(\d+) packets transmitted, (\d+) received/i', $line, $m)) {
                $transmitted = (int)$m[1];
                $received = (int)$m[2];
            }
            if (preg_match('/min\/avg\/max.*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/i', $line, $m)) {
                $minTime = (float)$m[1];
                $avgTime = (float)$m[2];
                $maxTime = (float)$m[3];
            }
            if (preg_match('/time[=\s]*([\d.]+)\s*ms/i', $line, $m)) {
                $packets[] = (float)$m[1];
            }
            if (preg_match('/Reply from.*time[<=]([\d.]+)ms/i', $line, $m)) {
                $packets[] = (float)$m[1];
            }
        }
        
        return [
            'host' => $host,
            'ip_version' => $isIPv6 ? 'IPv6' : 'IPv4',
            'transmitted' => $transmitted ?: $count,
            'received' => $received,
            'packet_loss' => $transmitted > 0 ? round((($transmitted - $received) / $transmitted) * 100, 2) : 0,
            'reachable' => $received > 0,
            'min_time_ms' => $minTime,
            'avg_time_ms' => $avgTime,
            'max_time_ms' => $maxTime,
            'packet_times' => $packets,
            'raw_output' => implode("\n", $output)
        ];
    }
    
    /**
     * What is My IP
     */
    public function whatIsMyIP($params) {
        $clientIP = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        $isIPv6 = filter_var($clientIP, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
        
        $geoInfo = $this->getGeoInfo($clientIP);
        
        return [
            'ip' => $clientIP,
            'ip_version' => $isIPv6 ? 'IPv6' : 'IPv4',
            'isp' => $geoInfo['isp'] ?? null,
            'organization' => $geoInfo['organization'] ?? null,
            'location' => [
                'country' => $geoInfo['country_name'] ?? null,
                'country_code' => $geoInfo['country_code'] ?? null,
                'region' => $geoInfo['state_prov'] ?? null,
                'city' => $geoInfo['city'] ?? null,
                'latitude' => $geoInfo['latitude'] ?? null,
                'longitude' => $geoInfo['longitude'] ?? null,
            ],
            'timezone' => $geoInfo['time_zone']['name'] ?? null,
            'is_private' => $this->isPrivateIP($clientIP),
            'is_loopback' => filter_var($clientIP, FILTER_VALIDATE_IP) && 
                            (strpos($clientIP, '127.') === 0 || $clientIP === '::1'),
            'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null
        ];
    }
    
    /**
     * Traceroute
     */
    public function traceroute($params) {
        $host = $params['host'] ?? '';
        $maxHops = min((int)($params['max_hops'] ?? 30), 50);
        $timeout = min((int)($params['timeout'] ?? 5), 30);
        
        if (empty($host)) {
            throw new Exception('Host is required');
        }
        
        $host = $this->sanitizeHost($host);
        
        if (!$this->isValidHostOrIP($host)) {
            throw new Exception('Invalid host or IP address');
        }
        
        $os = strtoupper(substr(PHP_OS, 0, 3));
        
        if ($os === 'WIN') {
            $cmd = sprintf('tracert -h %d -w %d %s 2>&1', $maxHops, $timeout * 1000, escapeshellarg($host));
        } else {
            $isIPv6 = filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
            $cmd = $isIPv6
                ? sprintf('traceroute6 -m %d -w %d %s 2>&1', $maxHops, $timeout, escapeshellarg($host))
                : sprintf('traceroute -m %d -w %d %s 2>&1', $maxHops, $timeout, escapeshellarg($host));
        }
        
        $output = [];
        $returnCode = 0;
        exec($cmd, $output, $returnCode);
        
        $hops = [];
        foreach ($output as $line) {
            // Parse traceroute output
            if (preg_match('/^\s*(\d+)\s+([\d*.a-zA-Z\-]+)?\s*(?:\(([\d.]+)\))?\s*([\d.\s*ms<!>]+)/', $line, $m)) {
                $hop = [
                    'hop' => (int)$m[1],
                    'host' => $m[2] ?: null,
                    'ip' => $m[3] ?? null,
                    'times' => []
                ];
                
                preg_match_all('/([\d.]+)\s*ms/', $m[4], $times);
                foreach ($times[1] as $time) {
                    $hop['times'][] = (float)$time;
                }
                
                $hops[] = $hop;
            } elseif (preg_match('/^\s*(\d+)\s+\*\s+\*\s+\*/', $line, $m)) {
                $hops[] = [
                    'hop' => (int)$m[1],
                    'host' => null,
                    'ip' => null,
                    'times' => [],
                    'timeout' => true
                ];
            }
        }
        
        return [
            'host' => $host,
            'hops_count' => count($hops),
            'completed' => count($hops) > 0 && end($hops)['host'] !== null,
            'hops' => $hops,
            'raw_output' => implode("\n", $output)
        ];
    }
    
    /**
     * IP Location Lookup
     */
    public function ipLocation($params) {
        $ip = $params['ip'] ?? ($_SERVER['REMOTE_ADDR'] ?? '');
        
        if (empty($ip)) {
            throw new Exception('IP address is required');
        }
        
        $ip = filter_var(trim($ip), FILTER_VALIDATE_IP);
        if (!$ip) {
            throw new Exception('Invalid IP address');
        }
        
        if ($this->isPrivateIP($ip)) {
            return [
                'ip' => $ip,
                'note' => 'Private IP address - location lookup not applicable',
                'is_private' => true
            ];
        }
        
        $geoInfo = $this->getGeoInfo($ip);
        
        return [
            'ip' => $ip,
            'is_private' => false,
            'continent' => [
                'name' => $geoInfo['continent_name'] ?? null,
                'code' => $geoInfo['continent_code'] ?? null,
            ],
            'country' => [
                'name' => $geoInfo['country_name'] ?? null,
                'code' => $geoInfo['country_code2'] ?? null,
                'capital' => $geoInfo['country_capital'] ?? null,
            ],
            'region' => [
                'name' => $geoInfo['state_prov'] ?? null,
            ],
            'city' => $geoInfo['city'] ?? null,
            'zipcode' => $geoInfo['zipcode'] ?? null,
            'coordinates' => [
                'latitude' => $geoInfo['latitude'] ?? null,
                'longitude' => $geoInfo['longitude'] ?? null,
            ],
            'timezone' => [
                'name' => $geoInfo['time_zone']['name'] ?? null,
                'offset' => $geoInfo['time_zone']['offset'] ?? null,
                'current_time' => $geoInfo['time_zone']['current_time'] ?? null,
            ],
            'isp' => [
                'name' => $geoInfo['isp'] ?? null,
                'organization' => $geoInfo['organization'] ?? null,
                'asn' => $geoInfo['asn'] ?? null,
            ],
            'currency' => $geoInfo['currency'] ?? null,
            'calling_code' => $geoInfo['calling_code'] ?? null,
        ];
    }
    
    /**
     * Email Header Analyzer
     */
    public function emailHeaderAnalyzer($params) {
        $headers = $params['headers'] ?? '';
        
        if (empty($headers)) {
            throw new Exception('Email headers are required');
        }
        
        // Limit input size
        if (strlen($headers) > 50000) {
            $headers = substr($headers, 0, 50000);
        }
        
        $analysis = [
            'raw_headers' => $headers,
            'parsed_headers' => [],
            'security_analysis' => [],
            'route' => [],
            'authentication' => [],
            'warnings' => []
        ];
        
        $lines = explode("\n", $headers);
        $currentHeader = '';
        
        foreach ($lines as $line) {
            if (preg_match('/^([A-Za-z\-]+):\s*(.*)$/', $line, $m)) {
                $currentHeader = $m[1];
                $analysis['parsed_headers'][$currentHeader][] = $m[2];
            } elseif ($currentHeader && (strpos($line, ' ') === 0 || strpos($line, "\t") === 0)) {
                $lastIdx = count($analysis['parsed_headers'][$currentHeader]) - 1;
                $analysis['parsed_headers'][$currentHeader][$lastIdx] .= $line;
            }
        }
        
        // SPF analysis
        if (isset($analysis['parsed_headers']['Received-SPF'])) {
            $spf = implode(', ', $analysis['parsed_headers']['Received-SPF']);
            $analysis['authentication']['spf'] = [
                'result' => $spf,
                'pass' => stripos($spf, 'pass') !== false,
                'fail' => stripos($spf, 'fail') !== false
            ];
        }
        
        // DKIM analysis
        if (isset($analysis['parsed_headers']['DKIM-Signature'])) {
            $dkim = $analysis['parsed_headers']['DKIM-Signature'][0];
            preg_match('/d=([^;]+)/', $dkim, $m);
            preg_match('/s=([^;]+)/', $dkim, $m2);
            $analysis['authentication']['dkim'] = [
                'domain' => isset($m[1]) ? trim($m[1]) : 'unknown',
                'selector' => isset($m2[1]) ? trim($m2[1]) : 'unknown',
                'signed' => true
            ];
        } else {
            $analysis['authentication']['dkim'] = ['signed' => false];
            $analysis['warnings'][] = 'Email is not DKIM signed';
        }
        
        // DMARC analysis
        if (isset($analysis['parsed_headers']['Authentication-Results'])) {
            $authResults = implode(' ', $analysis['parsed_headers']['Authentication-Results']);
            if (stripos($authResults, 'dmarc=') !== false) {
                preg_match('/dmarc=(\w+)/i', $authResults, $m);
                $analysis['authentication']['dmarc'] = [
                    'result' => $m[1] ?? 'unknown',
                    'pass' => (isset($m[1]) && stripos($m[1], 'pass') !== false)
                ];
            }
        }
        
        // Extract route (Received headers)
        if (isset($analysis['parsed_headers']['Received'])) {
            $received = $analysis['parsed_headers']['Received'];
            foreach (array_reverse($received) as $i => $recv) {
                preg_match('/from\s+([\w.\-]+)\s+\(?([\d.a-fA-F:]+)\)?/', $recv, $m);
                $analysis['route'][] = [
                    'hop' => $i + 1,
                    'host' => $m[1] ?? 'unknown',
                    'ip' => $m[2] ?? null,
                    'timestamp' => $this->extractTimestamp($recv)
                ];
            }
        }
        
        // Suspicious checks
        if (isset($analysis['parsed_headers']['Reply-To']) && isset($analysis['parsed_headers']['From'])) {
            $from = implode('', $analysis['parsed_headers']['From']);
            $replyTo = implode('', $analysis['parsed_headers']['Reply-To']);
            if (stripos($replyTo, $from) === false) {
                $analysis['warnings'][] = 'Reply-To address differs from From address - possible phishing';
            }
        }
        
        $analysis['security_score'] = count($analysis['warnings']) === 0 ? 'GOOD' : 
                                      (count($analysis['warnings']) < 3 ? 'SUSPICIOUS' : 'RISKY');
        
        return $analysis;
    }
    
    /**
     * IP Blacklist Checker
     */
    public function ipBlacklist($params) {
        $ip = $params['ip'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IP address is required');
        }
        
        $ip = filter_var(trim($ip), FILTER_VALIDATE_IP);
        if (!$ip) {
            throw new Exception('Invalid IP address');
        }
        
        $isIPv6 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
        
        $blacklists = [
            // Spam blacklists
            'zen.spamhaus.org',
            'bl.spamcop.net',
            'b.barracudacentral.org',
            'dnsbl.sorbs.net',
            'spam.dnsbl.sorbs.net',
            'bl.spameatingmonkey.net',
            'dnsbl.spfbl.net',
            'psbl.surriel.com',
            'dbl.spamhaus.org',
            'uribl.spameatingmonkey.net',
        ];
        
        $results = [];
        $listedCount = 0;
        
        if (!$isIPv6) {
            $reversedIP = implode('.', array_reverse(explode('.', $ip)));
            
            foreach ($blacklists as $bl) {
                $lookup = $reversedIP . '.' . $bl;
                $record = @dns_get_record($lookup, DNS_A);
                
                $listed = !empty($record);
                if ($listed) $listedCount++;
                
                $results[] = [
                    'blacklist' => $bl,
                    'listed' => $listed,
                    'details' => $listed ? ($record[0]['ip'] ?? 'Listed') : 'Not listed'
                ];
            }
        } else {
            // For IPv6, format is different - most BLs don't support it
            foreach ($blacklists as $bl) {
                $results[] = [
                    'blacklist' => $bl,
                    'listed' => null,
                    'details' => 'IPv6 check limited - manual verification recommended'
                ];
            }
        }
        
        return [
            'ip' => $ip,
            'listed' => $listedCount,
            'total_checked' => count($blacklists),
            'clean' => $listedCount === 0,
            'reputation' => $listedCount === 0 ? 'GOOD' : ($listedCount < 3 ? 'FAIR' : 'POOR'),
            'results' => $results
        ];
    }
    
    /**
     * IP to Decimal Converter
     */
    public function ipToDecimal($params) {
        $ip = $params['ip'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IP address is required');
        }
        
        $ip = trim($ip);
        $isIPv6 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
        $isIPv4 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4);
        
        if (!$isIPv4 && !$isIPv6) {
            throw new Exception('Invalid IP address');
        }
        
        if ($isIPv4) {
            $decimal = sprintf('%u', ip2long($ip));
            $hex = dechex(ip2long($ip));
            $binary = sprintf('%032b', ip2long($ip));
            
            return [
                'ip' => $ip,
                'version' => 'IPv4',
                'decimal' => $decimal,
                'hexadecimal' => '0x' . strtoupper($hex),
                'binary' => wordwrap($binary, 8, '.', true),
                'octal' => decoct(ip2long($ip)),
                'integer' => (int)$decimal
            ];
        }
        
        // IPv6
        $binary = inet_pton($ip);
        $hex = bin2hex($binary);
        $decimal = '0x' . $hex;
        
        return [
            'ip' => $ip,
            'version' => 'IPv6',
            'decimal' => $this->hexToDecimal($hex),
            'hexadecimal' => $hex,
            'binary' => wordwrap($this->hexToBinary($hex), 16, ':', true),
            'integer' => $decimal,
            'expanded' => $this->expandIPv6($ip)
        ];
    }
    
    /**
     * Resolve IP to Hostname (Reverse DNS)
     */
    public function resolveIPtoHostname($params) {
        $ip = $params['ip'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IP address is required');
        }
        
        $ip = filter_var(trim($ip), FILTER_VALIDATE_IP);
        if (!$ip) {
            throw new Exception('Invalid IP address');
        }
        
        $hostname = gethostbyaddr($ip);
        
        return [
            'ip' => $ip,
            'hostname' => $hostname !== $ip ? $hostname : null,
            'has_ptr' => $hostname !== $ip,
            'forward_match' => null
        ];
    }
    
    /**
     * IP WHOIS Lookup
     */
    public function ipWhois($params) {
        $ip = $params['ip'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IP address is required');
        }
        
        $ip = filter_var(trim($ip), FILTER_VALIDATE_IP);
        if (!$ip) {
            throw new Exception('Invalid IP address');
        }
        
        $isIPv6 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
        
        if ($isIPv6) {
            return $this->ipv6Whois($params);
        }
        
        $whoisServer = $this->getWhoisServerForIP($ip);
        $whoisData = $this->queryWhois($ip, $whoisServer);
        
        $parsed = $this->parseWhoisData($whoisData);
        
        return [
            'ip' => $ip,
            'whois_server' => $whoisServer,
            'raw' => $whoisData,
            'parsed' => $parsed,
            'netblock' => $parsed['NetRange'] ?? $parsed['inetnum'] ?? null,
            'organization' => $parsed['Organization'] ?? $parsed['org-name'] ?? $parsed['org'] ?? null,
            'country' => $parsed['Country'] ?? $parsed['country'] ?? null,
            'abuse_contact' => $parsed['OrgAbuseEmail'] ?? $parsed['abuse-mailbox'] ?? null,
        ];
    }
    
    /**
     * IPv6 WHOIS Lookup
     */
    public function ipv6Whois($params) {
        $ip = $params['ip'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IPv6 address is required');
        }
        
        $ip = filter_var(trim($ip), FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
        if (!$ip) {
            throw new Exception('Invalid IPv6 address');
        }
        
        $whoisServer = 'whois.ripe.net';
        $whoisData = $this->queryWhois($ip, $whoisServer);
        $parsed = $this->parseWhoisData($whoisData);
        
        return [
            'ip' => $ip,
            'whois_server' => $whoisServer,
            'raw' => $whoisData,
            'parsed' => $parsed,
            'netblock' => $parsed['inet6num'] ?? null,
            'organization' => $parsed['org-name'] ?? $parsed['descr'] ?? null,
            'country' => $parsed['country'] ?? null,
        ];
    }
    
    /**
     * IPv4 to IPv6 Converter
     */
    public function ipv4ToIPv6($params) {
        $ip = $params['ip'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IPv4 address is required');
        }
        
        $ip = filter_var(trim($ip), FILTER_VALIDATE_IP, FILTER_FLAG_IPV4);
        if (!$ip) {
            throw new Exception('Invalid IPv4 address');
        }
        
        $parts = explode('.', $ip);
        $hexParts = array_map(function($p) {
            return str_pad(dechex($p), 2, '0', STR_PAD_LEFT);
        }, $parts);
        
        // IPv4-mapped IPv6 address format
        $ipv6Mapped = '::ffff:' . implode('.', $parts);
        $ipv6Full = '0000:0000:0000:0000:0000:ffff:' . implode(array_slice($hexParts, 0, 2), '') . ':' . implode(array_slice($hexParts, 2, 2), '');
        
        // 6to4 address
        $hexIP = '';
        foreach ($parts as $p) {
            $hexIP .= str_pad(dechex($p), 2, '0', STR_PAD_LEFT);
        }
        $ipv6_6to4 = '2002:' . substr($hexIP, 0, 2) . substr($hexIP, 2, 2) . ':' . substr($hexIP, 4, 2) . substr($hexIP, 6, 2) . '::/48';
        
        return [
            'ipv4' => $ip,
            'ipv6_mapped' => $ipv6Mapped,
            'ipv6_mapped_full' => $ipv6Full,
            'ipv6_6to4' => $ipv6_6to4,
            'teredo' => '2001:0000:' . implode(':', str_split(implode($hexParts), 4)) . '::/32',
            'conversion_type' => 'IPv4-mapped IPv6'
        ];
    }
    
    /**
     * Local IPv6 Generator
     */
    public function localIPv6Generator($params) {
        $count = min((int)($params['count'] ?? 5), 50);
        $addresses = [];
        
        // Generate unique local addresses (ULA) fc00::/7
        for ($i = 0; $i < $count; $i++) {
            // Generate random 40-bit global ID
            $globalID = bin2hex(random_bytes(5));
            // Generate random 16-bit subnet ID
            $subnetID = str_pad(dechex(random_int(0, 65535)), 4, '0', STR_PAD_LEFT);
            // Generate random 64-bit interface ID
            $interfaceID = bin2hex(random_bytes(8));
            
            $ula = 'fd' . substr($globalID, 0, 2) . ':' . substr($globalID, 2, 4) . ':' . substr($globalID, 6, 4) . ':' . $subnetID . ':' . 
                   substr($interfaceID, 0, 4) . ':' . substr($interfaceID, 4, 4) . ':' . substr($interfaceID, 8, 4) . ':' . substr($interfaceID, 12, 4);
            
            $addresses[] = [
                'address' => $ula,
                'type' => 'ULA (Unique Local Address)',
                'scope' => 'local',
                'compressed' => $this->compressIPv6($ula)
            ];
        }
        
        // Generate link-local addresses
        $linkLocalPrefix = 'fe80::';
        for ($i = 0; $i < min(3, $count); $i++) {
            $suffix = bin2hex(random_bytes(8));
            $lla = 'fe80::' . substr($suffix, 0, 4) . ':' . substr($suffix, 4, 4) . ':' . substr($suffix, 8, 4) . ':' . substr($suffix, 12, 4);
            
            $addresses[] = [
                'address' => $lla,
                'type' => 'LLA (Link-Local Address)',
                'scope' => 'link-local',
                'compressed' => $this->compressIPv6($lla)
            ];
        }
        
        return [
            'generated_addresses' => $addresses,
            'count' => count($addresses),
            'types' => ['ULA (fc00::/7)', 'LLA (fe80::/10)']
        ];
    }
    
    /**
     * IPv6 CIDR to Range
     */
    public function ipv6CIDRtoRange($params) {
        $cidr = $params['cidr'] ?? '';
        
        if (empty($cidr)) {
            throw new Exception('IPv6 CIDR notation is required (e.g., 2001:db8::/32)');
        }
        
        if (!preg_match('/^([0-9a-fA-F:]+)\/(\d+)$/', $cidr, $m)) {
            throw new Exception('Invalid CIDR format');
        }
        
        $ip = $m[1];
        $prefix = (int)$m[2];
        
        if ($prefix < 1 || $prefix > 128) {
            throw new Exception('Invalid prefix length (must be 1-128)');
        }
        
        $binary = inet_pton($ip);
        if ($binary === false) {
            throw new Exception('Invalid IPv6 address');
        }
        
        // Calculate range
        $hex = bin2hex($binary);
        $bits = str_pad('', 128, '0');
        $bits = str_pad('', $prefix, '1') . substr($bits, $prefix);
        
        // Network address (lower bits set to 0)
        $networkBinary = '';
        for ($i = 0; $i < 16; $i++) {
            $byte = hexdec(substr($hex, $i * 2, 2));
            $mask = $prefix > ($i * 8) ? (0xFF << max(0, 8 - ($prefix - $i * 8))) & 0xFF : 0;
            $networkBinary .= chr($byte & $mask);
        }
        
        $networkHex = bin2hex($networkBinary);
        $networkIP = $this->binaryToIPv6($networkBinary);
        
        // Broadcast address (lower bits set to 1)
        $broadcastBinary = '';
        for ($i = 0; $i < 16; $i++) {
            $byte = hexdec(substr($hex, $i * 2, 2));
            $mask = $prefix > ($i * 8) ? (0xFF << max(0, 8 - ($prefix - $i * 8))) & 0xFF : 0;
            $broadcastBinary .= chr($byte | (~$mask & 0xFF));
        }
        
        $broadcastIP = $this->binaryToIPv6($broadcastBinary);
        
        // Total addresses
        $totalAddresses = bcpow('2', (string)(128 - $prefix));
        
        return [
            'cidr' => $cidr,
            'network_address' => $networkIP,
            'broadcast_address' => $broadcastIP,
            'first_address' => $networkIP,
            'last_address' => $broadcastIP,
            'prefix_length' => $prefix,
            'total_addresses' => $totalAddresses,
            'usable_hosts' => bcsub($totalAddresses, '2'),
            'mask_bits' => $prefix,
        ];
    }
    
    /**
     * IPv6 Range to CIDR
     */
    public function ipv6RangeToCIDR($params) {
        $startIP = $params['start'] ?? '';
        $endIP = $params['end'] ?? '';
        
        if (empty($startIP) || empty($endIP)) {
            throw new Exception('Both start and end IPv6 addresses are required');
        }
        
        $start = inet_pton($startIP);
        $end = inet_pton($endIP);
        
        if ($start === false || $end === false) {
            throw new Exception('Invalid IPv6 address(es)');
        }
        
        // Compare bytes to find common prefix
        $prefix = 0;
        for ($i = 0; $i < 16; $i++) {
            $xor = ord($start[$i]) ^ ord($end[$i]);
            if ($xor === 0) {
                $prefix += 8;
            } else {
                for ($j = 7; $j >= 0; $j--) {
                    if (!(($xor >> $j) & 1)) {
                        $prefix++;
                    } else {
                        break 2;
                    }
                }
            }
        }
        
        return [
            'start_ip' => $this->expandIPv6($startIP),
            'end_ip' => $this->expandIPv6($endIP),
            'cidr_notation' => $this->expandIPv6($startIP) . '/' . $prefix,
            'prefix_length' => $prefix,
            'total_addresses' => bcpow('2', (string)(128 - $prefix)),
        ];
    }
    
    /**
     * IPv6 Compatibility Checker
     */
    public function ipv6Compatibility($params) {
        $host = $params['host'] ?? '';
        
        if (empty($host)) {
            throw new Exception('Host is required');
        }
        
        $host = $this->sanitizeHost($host);
        
        $ipv4Records = dns_get_record($host, DNS_A) ?: [];
        $ipv6Records = dns_get_record($host, DNS_AAAA) ?: [];
        $mxRecords = dns_get_record($host, DNS_MX) ?: [];
        
        // Check MX records for IPv6
        $mxIPv6 = [];
        foreach ($mxRecords as $mx) {
            $mxHost = $mx['target'];
            $mxHasV6 = !empty(dns_get_record($mxHost, DNS_AAAA));
            $mxIPv6[] = [
                'host' => $mxHost,
                'has_ipv6' => $mxHasV6
            ];
        }
        
        // Check NS records for IPv6
        $nsRecords = dns_get_record($host, DNS_NS) ?: [];
        $nsIPv6 = [];
        foreach ($nsRecords as $ns) {
            $nsHost = $ns['target'];
            $nsHasV6 = !empty(dns_get_record($nsHost, DNS_AAAA));
            $nsIPv6[] = [
                'host' => $nsHost,
                'has_ipv6' => $nsHasV6
            ];
        }
        
        $hasAAAA = !empty($ipv6Records);
        $hasA = !empty($ipv4Records);
        $mxHasV6Count = count(array_filter($mxIPv6, function($m) { return $m['has_ipv6']; }));
        $nsHasV6Count = count(array_filter($nsIPv6, function($n) { return $n['has_ipv6']; }));
        
        return [
            'host' => $host,
            'has_ipv4' => $hasA,
            'has_ipv6' => $hasAAAA,
            'dual_stack' => $hasA && $hasAAAA,
            'ipv6_addresses' => array_column($ipv6Records, 'ipv6'),
            'ipv4_addresses' => array_column($ipv4Records, 'ip'),
            'mx_records' => $mxIPv6,
            'mx_ipv6_ready' => empty($mxRecords) ? null : ($mxHasV6Count === count($mxRecords)),
            'ns_records' => $nsIPv6,
            'ns_ipv6_ready' => $nsHasV6Count === count($nsRecords),
            'compatibility_score' => $this->calculateIPv6Score($hasA, $hasAAAA, $mxHasV6Count, count($mxRecords), $nsHasV6Count, count($nsRecords)),
            'status' => $hasAAAA ? 'IPv6 Ready' : 'IPv6 Not Configured'
        ];
    }
    
    /**
     * IPv6 Compression Tool
     */
    public function ipv6Compression($params) {
        $ip = $params['ip'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IPv6 address is required');
        }
        
        $expanded = $this->expandIPv6(trim($ip));
        if (!$expanded) {
            throw new Exception('Invalid IPv6 address');
        }
        
        $compressed = $this->compressIPv6($expanded);
        
        return [
            'original' => $ip,
            'expanded' => $expanded,
            'compressed' => $compressed,
        ];
    }
    
    /**
     * IPv6 Expand Tool
     */
    public function ipv6Expand($params) {
        return $this->ipv6Compression($params);
    }
    
    /**
     * Subnet Calculator
     */
    public function subnetCalculator($params) {
        $ip = $params['ip'] ?? '';
        $mask = $params['mask'] ?? '';
        $cidr = $params['cidr'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IP address is required');
        }
        
        $isIPv6 = filter_var(trim($ip), FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
        
        if ($isIPv6) {
            return $this->ipv6CIDRtoRange($params);
        }
        
        // IPv4 subnet calculation
        $ipLong = ip2long(trim($ip));
        if ($ipLong === false) {
            throw new Exception('Invalid IPv4 address');
        }
        
        // Determine CIDR
        if (!empty($cidr)) {
            $cidrBits = (int)$cidr;
        } elseif (!empty($mask)) {
            $maskLong = ip2long($mask);
            if ($maskLong !== false) {
                $cidrBits = 32 - log((~$maskLong) & 0xFFFFFFFF, 2);
            } else {
                $cidrBits = 24; // default
            }
        } else {
            // Auto-detect class
            $firstOctet = ($ipLong >> 24) & 0xFF;
            if ($firstOctet < 128) $cidrBits = 8;
            elseif ($firstOctet < 192) $cidrBits = 16;
            elseif ($firstOctet < 224) $cidrBits = 24;
            else $cidrBits = 24;
        }
        
        if ($cidrBits < 0 || $cidrBits > 32) {
            throw new Exception('Invalid CIDR/mask');
        }
        
        $maskLong = 0xFFFFFFFF << (32 - $cidrBits);
        $wildcard = ~$maskLong & 0xFFFFFFFF;
        
        $network = $ipLong & $maskLong;
        $broadcast = $network | $wildcard;
        
        $totalHosts = pow(2, 32 - $cidrBits);
        $usableHosts = max(0, $totalHosts - 2);
        
        return [
            'ip_address' => long2ip($ipLong),
            'network_class' => $this->getNetworkClass($ipLong),
            'cidr' => '/' . $cidrBits,
            'subnet_mask' => long2ip($maskLong & 0xFFFFFFFF),
            'wildcard_mask' => long2ip($wildcard & 0xFFFFFFFF),
            'network_address' => long2ip($network),
            'broadcast_address' => $cidrBits < 31 ? long2ip($broadcast) : 'N/A',
            'first_usable_host' => $usableHosts > 0 ? long2ip($network + 1) : 'N/A',
            'last_usable_host' => $usableHosts > 0 ? long2ip($broadcast - 1) : 'N/A',
            'total_hosts' => $totalHosts,
            'usable_hosts' => $usableHosts,
            'binary_subnet_mask' => wordwrap(sprintf('%032b', $maskLong & 0xFFFFFFFF), 8, '.', true),
        ];
    }
    
    /**
     * IPv6 to IPv4 Converter
     */
    public function ipv6ToIPv4($params) {
        $ip = $params['ip'] ?? '';
        
        if (empty($ip)) {
            throw new Exception('IPv6 address is required');
        }
        
        $ip = trim($ip);
        $binary = inet_pton($ip);
        
        if ($binary === false || strlen($binary) !== 16) {
            throw new Exception('Invalid IPv6 address');
        }
        
        $hex = bin2hex($binary);
        
        // Check for IPv4-mapped (::ffff:xxxx:xxxx)
        if (substr($hex, 0, 24) === '00000000000000000000ffff') {
            $ipv4Hex = substr($hex, 24);
            $ipv4 = hexdec(substr($ipv4Hex, 0, 2)) . '.' . 
                    hexdec(substr($ipv4Hex, 2, 2)) . '.' .
                    hexdec(substr($ipv4Hex, 4, 2)) . '.' .
                    hexdec(substr($ipv4Hex, 6, 2));
            
            return [
                'ipv6' => $ip,
                'ipv4' => $ipv4,
                'type' => 'IPv4-mapped IPv6 address',
                'mapped' => true
            ];
        }
        
        // Check for 6to4 (2002::/16)
        if (substr($hex, 0, 4) === '2002') {
            $ipv4Hex = substr($hex, 4, 8);
            $ipv4 = hexdec(substr($ipv4Hex, 0, 2)) . '.' . 
                    hexdec(substr($ipv4Hex, 2, 2)) . '.' .
                    hexdec(substr($ipv4Hex, 4, 2)) . '.' .
                    hexdec(substr($ipv4Hex, 6, 2));
            
            return [
                'ipv6' => $ip,
                'ipv4' => $ipv4,
                'type' => '6to4 address',
                'mapped' => true
            ];
        }
        
        return [
            'ipv6' => $ip,
            'ipv4' => null,
            'type' => 'Native IPv6 address - no embedded IPv4',
            'mapped' => false
        ];
    }
    
    /**
     * ISP Checker
     */
    public function ispChecker($params) {
        $ip = $params['ip'] ?? ($_SERVER['REMOTE_ADDR'] ?? '');
        
        if (empty($ip)) {
            throw new Exception('IP address is required');
        }
        
        $ip = filter_var(trim($ip), FILTER_VALIDATE_IP);
        if (!$ip) {
            throw new Exception('Invalid IP address');
        }
        
        $geoInfo = $this->getGeoInfo($ip);
        
        return [
            'ip' => $ip,
            'isp' => [
                'name' => $geoInfo['isp'] ?? 'Unknown',
                'organization' => $geoInfo['organization'] ?? null,
                'asn' => $geoInfo['asn'] ?? null,
            ],
            'connection_type' => $geoInfo['connection_type'] ?? 'Unknown',
            'location' => [
                'country' => $geoInfo['country_name'] ?? null,
                'city' => $geoInfo['city'] ?? null,
            ],
            'is_hosting' => stripos($geoInfo['organization'] ?? '', 'hosting') !== false ||
                           stripos($geoInfo['isp'] ?? '', 'cloud') !== false ||
                           stripos($geoInfo['isp'] ?? '', 'amazon') !== false ||
                           stripos($geoInfo['isp'] ?? '', 'google') !== false ||
                           stripos($geoInfo['isp'] ?? '', 'microsoft') !== false,
            'is_vpn' => stripos($geoInfo['connection_type'] ?? '', 'VPN') !== false
        ];
    }
    
    /**
     * Website to IP Lookup
     */
    public function websiteToIP($params) {
        $url = $params['url'] ?? '';
        
        if (empty($url)) {
            throw new Exception('Website URL is required');
        }
        
        $host = parse_url($url, PHP_URL_HOST) ?: $url;
        $host = $this->sanitizeHost($host);
        
        if (!$this->isValidHostOrIP($host)) {
            throw new Exception('Invalid website URL');
        }
        
        $ipv4 = gethostbyname($host);
        $ipv4List = [];
        $ipv6List = [];
        
        if ($ipv4 !== $host) {
            $ipv4List[] = $ipv4;
        }
        
        // Try to get all A records
        $aRecords = dns_get_record($host, DNS_A);
        if ($aRecords) {
            $ipv4List = array_unique(array_merge($ipv4List, array_column($aRecords, 'ip')));
        }
        
        // Try AAAA records
        $aaaaRecords = dns_get_record($host, DNS_AAAA);
        if ($aaaaRecords) {
            $ipv6List = array_column($aaaaRecords, 'ipv6');
        }
        
        return [
            'website' => $host,
            'ipv4_addresses' => $ipv4List,
            'ipv6_addresses' => $ipv6List,
            'has_ipv6' => !empty($ipv6List),
            'nameservers' => $this->getWebsiteNS($host),
            'mx_servers' => $this->getWebsiteMX($host),
        ];
    }
    
    // ==================== HELPER METHODS ====================
    
    private function sanitizeHost($host) {
        $host = strtolower(trim($host));
        $host = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $host);
        $host = preg_replace('/\/.*$/', '', $host);
        $host = preg_replace('/[^a-z0-9.\-:]/', '', $host);
        return substr($host, 0, 253);
    }
    
    private function isValidHostOrIP($host) {
        if (filter_var($host, FILTER_VALIDATE_IP)) return true;
        if (filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) return true;
        return false;
    }
    
    private function isPrivateIP($ip) {
        return !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }
    
    private function getGeoInfo($ip) {
        // Try ip-api.com (free, no key required)
        try {
            $ch = curl_init("http://ip-api.com/json/{$ip}?fields=status,message,continent,continentCode,country,countryCode,region,regionName,city,zip,lat,lon,timezone,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query");
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 5);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_USERAGENT, 'WHMCS-Tools-Center/1.0');
            $response = curl_exec($ch);
            curl_close($ch);
            
            if ($response) {
                $data = json_decode($response, true);
                if ($data && $data['status'] === 'success') {
                    return [
                        'country_name' => $data['country'],
                        'country_code2' => $data['countryCode'],
                        'state_prov' => $data['regionName'],
                        'city' => $data['city'],
                        'zipcode' => $data['zip'],
                        'latitude' => $data['lat'],
                        'longitude' => $data['lon'],
                        'isp' => $data['isp'],
                        'organization' => $data['org'],
                        'asn' => $data['as'],
                        'timezone' => ['name' => $data['timezone']],
                        'currency' => $data['currency'],
                        'is_proxy' => $data['proxy'],
                        'is_hosting' => $data['hosting'],
                    ];
                }
            }
        } catch (Exception $e) {
            // Fallback
        }
        
        return [];
    }
    
    private function expandIPv6($ip) {
        $hex = bin2hex(inet_pton($ip));
        $groups = [];
        for ($i = 0; $i < 16; $i += 2) {
            $groups[] = substr($hex, $i * 2, 4);
        }
        return implode(':', $groups);
    }
    
    private function compressIPv6($ip) {
        $ip = strtolower($ip);
        // Remove leading zeros
        $parts = explode(':', $ip);
        $parts = array_map(function($p) {
            return ltrim($p, '0') ?: '0';
        }, $parts);
        
        $compressed = implode(':', $parts);
        
        // Find longest sequence of :0: and replace with ::
        if (strpos($compressed, ':0:') !== false || strpos($compressed, ':0') !== false) {
            $compressed = preg_replace('/(:0)+/', ':', $compressed, 1);
        }
        
        return $compressed;
    }
    
    private function binaryToIPv6($binary) {
        $hex = bin2hex($binary);
        $groups = [];
        for ($i = 0; $i < 32; $i += 4) {
            $groups[] = substr($hex, $i, 4);
        }
        return implode(':', $groups);
    }
    
    private function hexToDecimal($hex) {
        $result = '0';
        for ($i = 0; $i < strlen($hex); $i++) {
            $result = bcadd(bcmul($result, '16', 0), (string)hexdec($hex[$i]), 0);
        }
        return $result;
    }
    
    private function hexToBinary($hex) {
        $result = '';
        for ($i = 0; $i < strlen($hex); $i++) {
            $result .= str_pad(decbin(hexdec($hex[$i])), 4, '0', STR_PAD_LEFT);
        }
        return $result;
    }
    
    private function calculateIPv6Score($hasA, $hasAAAA, $mxV6, $mxTotal, $nsV6, $nsTotal) {
        $score = 0;
        if ($hasAAAA) $score += 40;
        if ($hasA && $hasAAAA) $score += 20; // dual-stack bonus
        if ($mxTotal > 0 && $mxV6 === $mxTotal) $score += 20;
        if ($nsV6 === $nsTotal) $score += 20;
        return $score;
    }
    
    private function extractTimestamp($header) {
        // Common date patterns in Received headers
        $months = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
        if (preg_match('/(' . $months . ')\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/', $header, $m)) {
            return $m[0];
        }
        if (preg_match('/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/', $header, $m)) {
            return $m[0];
        }
        return null;
    }
    
    private function getWhoisServerForIP($ip) {
        $firstOctet = (int)explode('.', $ip)[0];
        
        if ($firstOctet < 128) return 'whois.arin.net';
        if ($firstOctet < 192) {
            // Could be RIPE, APNIC, ARIN, LACNIC, AFRINIC
            return 'whois.ripe.net';
        }
        return 'whois.arin.net';
    }
    
    private function queryWhois($query, $server) {
        $socket = @fsockopen($server, 43, $errno, $errstr, 10);
        if (!$socket) return '';
        
        fputs($socket, $query . "\r\n");
        $result = '';
        while (!feof($socket)) {
            $result .= fgets($socket, 128);
        }
        fclose($socket);
        
        return $result;
    }
    
    private function parseWhoisData($data) {
        $parsed = [];
        $lines = explode("\n", $data);
        
        foreach ($lines as $line) {
            if (strpos($line, ':') !== false) {
                list($key, $value) = explode(':', $line, 2);
                $key = trim($key);
                $value = trim($value);
                if (!empty($key) && !empty($value)) {
                    $parsed[$key] = $value;
                }
            }
        }
        
        return $parsed;
    }
    
    private function getNetworkClass($ipLong) {
        $firstOctet = ($ipLong >> 24) & 0xFF;
        if ($firstOctet < 128) return 'A';
        if ($firstOctet < 192) return 'B';
        if ($firstOctet < 224) return 'C';
        if ($firstOctet < 240) return 'D (Multicast)';
        return 'E (Experimental)';
    }
    
    private function getWebsiteNS($host) {
        $records = dns_get_record($host, DNS_NS) ?: [];
        return array_column($records, 'target');
    }
    
    private function getWebsiteMX($host) {
        $records = dns_get_record($host, DNS_MX) ?: [];
        return array_map(function($r) {
            return ['host' => $r['target'], 'priority' => $r['pri']];
        }, $records);
    }
}