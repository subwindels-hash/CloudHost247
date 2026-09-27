<?php
/**
 * CloudHost247 Tools - IP Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

function CloudHost247_tool_ping_ipv4($post)
{
    $host = CloudHost247_tools_sanitize($post['host'] ?? '', 'domain');
    if (empty($host)) {
        return ['error' => 'Please enter a host or IP address'];
    }
    return CloudHost247_tools_ping($host, false, 4, 3);
}

function CloudHost247_tool_ping_ipv6($post)
{
    $host = CloudHost247_tools_sanitize($post['host'] ?? '', 'domain');
    if (empty($host)) {
        return ['error' => 'Please enter a host or IP address'];
    }
    return CloudHost247_tools_ping($host, true, 4, 3);
}

function CloudHost247_tool_what_is_my_ip($post)
{
    $ip = CloudHost247_tools_get_client_ip();
    $hostname = gethostbyaddr($ip) ?: null;

    return [
        'ip' => $ip,
        'hostname' => $hostname,
        'is_ipv6' => CloudHost247_tools_validate_ipv6($ip),
    ];
}

function CloudHost247_tool_traceroute($post)
{
    $host = CloudHost247_tools_sanitize($post['host'] ?? '', 'domain');
    if (empty($host)) {
        return ['error' => 'Please enter a host or IP address'];
    }
    return CloudHost247_tools_traceroute($host, 30, 5);
}

function CloudHost247_tool_ip_location($post)
{
    $ip = CloudHost247_tools_sanitize($post['ip'] ?? '', 'ip');
    if (empty($ip)) {
        $ip = CloudHost247_tools_get_client_ip();
    }
    if (!CloudHost247_tools_validate_ip($ip)) {
        return ['error' => 'Invalid IP address'];
    }

    $cacheKey = 'geoip_' . md5($ip);
    $cached = CloudHost247_tools_cache_get($cacheKey);
    if ($cached !== null) {
        return array_merge($cached, ['cached' => true]);
    }

    // Try free ip-api.com first
    $result = CloudHost247_tools_curl("http://ip-api.com/json/{$ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting", null, [], 10);

    if ($result['code'] === 200) {
        $data = json_decode($result['body'], true);
        if ($data && $data['status'] === 'success') {
            $output = [
                'ip' => $ip,
                'country' => $data['country'] ?? '',
                'country_code' => $data['countryCode'] ?? '',
                'region' => $data['regionName'] ?? '',
                'city' => $data['city'] ?? '',
                'zip' => $data['zip'] ?? '',
                'latitude' => $data['lat'] ?? 0,
                'longitude' => $data['lon'] ?? 0,
                'timezone' => $data['timezone'] ?? '',
                'isp' => $data['isp'] ?? '',
                'organization' => $data['org'] ?? '',
                'asn' => $data['as'] ?? '',
                'mobile' => $data['mobile'] ?? false,
                'proxy' => $data['proxy'] ?? false,
                'hosting' => $data['hosting'] ?? false,
            ];
            CloudHost247_tools_cache_set($cacheKey, $output, 15);
            return $output;
        }
    }

    return ['error' => 'Could not retrieve location data'];
}

function CloudHost247_tool_email_header_analyzer($post)
{
    $header = $_POST['header'] ?? '';
    if (empty($header)) {
        return ['error' => 'Please paste an email header'];
    }

    $header = trim($header);
    $results = [];

    // Extract Received headers
    preg_match_all('/Received:\s*([^\n]+(?:\n\s+[^\n]+)*)/i', $header, $received);
    if ($received[1]) {
        $results['received'] = array_reverse(array_map('trim', $received[1]));
    }

    // Extract From
    if (preg_match('/From:\s*([^\n]+)/i', $header, $match)) {
        $results['from'] = trim($match[1]);
    }

    // Extract To
    if (preg_match('/To:\s*([^\n]+)/i', $header, $match)) {
        $results['to'] = trim($match[1]);
    }

    // Extract Subject
    if (preg_match('/Subject:\s*([^\n]+)/i', $header, $match)) {
        $results['subject'] = trim($match[1]);
    }

    // Extract Date
    if (preg_match('/Date:\s*([^\n]+)/i', $header, $match)) {
        $results['date'] = trim($match[1]);
    }

    // Extract Message-ID
    if (preg_match('/Message-ID:\s*<([^>]+)>/i', $header, $match)) {
        $results['message_id'] = trim($match[1]);
    }

    // Extract SPF/DKIM/DMARC results
    if (preg_match('/spf=([a-z]+)/i', $header, $match)) {
        $results['spf_result'] = $match[1];
    }
    if (preg_match('/dkim=([a-z]+)/i', $header, $match)) {
        $results['dkim_result'] = $match[1];
    }
    if (preg_match('/dmarc=([a-z]+)/i', $header, $match)) {
        $results['dmarc_result'] = $match[1];
    }

    // Check for suspicious patterns
    $warnings = [];
    if (stripos($header, 'X-Originating-IP') !== false) {
        $warnings[] = 'Contains originating IP (possible privacy concern)';
    }
    if (isset($results['spf_result']) && $results['spf_result'] !== 'pass') {
        $warnings[] = 'SPF check did not pass';
    }
    if (isset($results['dkim_result']) && $results['dkim_result'] !== 'pass') {
        $warnings[] = 'DKIM check did not pass';
    }

    return array_merge($results, ['warnings' => $warnings]);
}

function CloudHost247_tool_ip_blacklist($post)
{
    $ip = CloudHost247_tools_sanitize($post['ip'] ?? '', 'ip');
    if (!CloudHost247_tools_validate_ip($ip)) {
        return ['error' => 'Invalid IP address'];
    }

    $rbls = [
        'zen.spamhaus.org',
        'bl.spamcop.net',
        'b.barracudacentral.org',
        'dnsbl.sorbs.net',
        'spam.dnsbl.sorbs.net',
        'bl.spameatingmonkey.net',
        'dnsbl.justspam.org',
        'bl.mailspike.net',
        'dnsbl-1.uceprotect.net',
        'dnsbl-2.uceprotect.net',
        'dnsbl-3.uceprotect.net',
    ];

    $results = [];
    $listedCount = 0;

    foreach ($rbls as $rbl) {
        $reversed = implode('.', array_reverse(explode('.', $ip)));
        $lookup = $reversed . '.' . $rbl;
        $listed = gethostbyname($lookup) !== $lookup;
        if ($listed) $listedCount++;
        $results[] = ['rbl' => $rbl, 'listed' => $listed];
    }

    return [
        'ip' => $ip,
        'total_rbls' => count($rbls),
        'listed_count' => $listedCount,
        'clean' => $listedCount === 0,
        'results' => $results,
    ];
}

function CloudHost247_tool_ip_to_decimal($post)
{
    $ip = CloudHost247_tools_sanitize($post['ip'] ?? '', 'ip');
    if (!CloudHost247_tools_validate_ipv4($ip)) {
        return ['error' => 'Invalid IPv4 address'];
    }

    $parts = explode('.', $ip);
    $decimal = ($parts[0] * 16777216) + ($parts[1] * 65536) + ($parts[2] * 256) + $parts[3];
    $hex = strtoupper(dechex($decimal));
    $binary = str_pad(decbin($decimal), 32, '0', STR_PAD_LEFT);
    $octal = decoct($decimal);

    return [
        'ip' => $ip,
        'decimal' => $decimal,
        'hex' => $hex,
        'binary' => $binary,
        'octal' => $octal,
    ];
}

function CloudHost247_tool_ip_to_hostname($post)
{
    return CloudHost247_tool_reverse_ip_lookup($post);
}

function CloudHost247_tool_ip_whois($post)
{
    $ip = CloudHost247_tools_sanitize($post['ip'] ?? '', 'ip');
    if (!CloudHost247_tools_validate_ipv4($ip)) {
        return ['error' => 'Invalid IPv4 address'];
    }

    $result = CloudHost247_tools_whois($ip, 'whois.arin.net');
    return ['ip' => $ip, 'whois' => $result['result'] ?? '', 'server' => $result['server'] ?? ''];
}

function CloudHost247_tool_ipv6_whois($post)
{
    $ip = CloudHost247_tools_sanitize($post['ip'] ?? '', 'ip');
    if (!CloudHost247_tools_validate_ipv6($ip)) {
        return ['error' => 'Invalid IPv6 address'];
    }

    // Try whois.ripe.net for IPv6
    $result = CloudHost247_tools_whois($ip, 'whois.ripe.net');
    return ['ip' => $ip, 'whois' => $result['result'] ?? '', 'server' => $result['server'] ?? ''];
}

function CloudHost247_tool_ipv4_ipv6_converter($post)
{
    $input = CloudHost247_tools_sanitize($post['input'] ?? '', 'string');
    $direction = CloudHost247_tools_sanitize($post['direction'] ?? 'v4_to_v6', 'string');

    if ($direction === 'v4_to_v6') {
        if (!CloudHost247_tools_validate_ipv4($input)) {
            return ['error' => 'Invalid IPv4 address'];
        }
        $parts = array_map('intval', explode('.', $input));
        $hexParts = array_map(function ($p) {
            return str_pad(dechex($p), 2, '0', STR_PAD_LEFT);
        }, $parts);
        $ipv6 = '::ffff:' . implode('', array_slice($hexParts, 0, 2)) . ':' . implode('', array_slice($hexParts, 2, 2));
        return ['ipv4' => $input, 'ipv6' => $ipv6, 'direction' => 'IPv4 to IPv6 Mapped'];
    } else {
        if (!CloudHost247_tools_validate_ipv6($input)) {
            return ['error' => 'Invalid IPv6 address'];
        }
        // Try to extract IPv4 from IPv4-mapped IPv6
        if (preg_match('/::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})/i', $input, $matches) ||
            preg_match('/::ffff:([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i', $input, $matches)) {
            if (isset($matches[1]) && strpos($matches[1], '.') === false) {
                $p1 = hexdec($matches[1]);
                $p2 = hexdec($matches[2]);
                $ipv4 = (($p1 >> 8) & 0xFF) . '.' . ($p1 & 0xFF) . '.' . (($p2 >> 8) & 0xFF) . '.' . ($p2 & 0xFF);
            } else {
                $ipv4 = $matches[1];
            }
            return ['ipv6' => $input, 'ipv4' => $ipv4 ?? 'N/A', 'direction' => 'IPv6 to IPv4'];
        }
        return ['ipv6' => $input, 'ipv4' => 'Not an IPv4-mapped address', 'direction' => 'IPv6 to IPv4'];
    }
}

function CloudHost247_tool_ipv6_generator($post)
{
    $count = min((int) ($post['count'] ?? 5), 20);
    $addresses = [];
    for ($i = 0; $i < $count; $i++) {
        $parts = [];
        for ($j = 0; $j < 8; $j++) {
            $parts[] = str_pad(dechex(mt_rand(0, 65535)), 4, '0', STR_PAD_LEFT);
        }
        $addresses[] = implode(':', $parts);
    }
    return ['count' => $count, 'addresses' => $addresses];
}

function CloudHost247_tool_ipv6_cidr($post)
{
    $ipv6 = CloudHost247_tools_sanitize($post['ipv6'] ?? '', 'ip');
    $prefix = (int) ($post['prefix'] ?? 64);
    if (!CloudHost247_tools_validate_ipv6($ipv6)) {
        return ['error' => 'Invalid IPv6 address'];
    }
    if ($prefix < 1 || $prefix > 128) {
        return ['error' => 'Prefix must be between 1 and 128'];
    }

    // Simple calculation
    $totalAddresses = gmp_strval(gmp_pow(2, 128 - $prefix));

    return [
        'ipv6' => $ipv6,
        'prefix' => $prefix,
        'total_addresses' => $totalAddresses,
        'network_size' => CloudHost247_tools_bytes_to_human(gmp_intval(gmp_div(gmp_pow(2, 128 - $prefix), 1))),
    ];
}

function CloudHost247_tool_ipv6_compress($post)
{
    $ipv6 = CloudHost247_tools_sanitize($post['ipv6'] ?? '', 'ip');
    $mode = CloudHost247_tools_sanitize($post['mode'] ?? 'compress', 'string');

    if (!CloudHost247_tools_validate_ipv6($ipv6)) {
        return ['error' => 'Invalid IPv6 address'];
    }

    if ($mode === 'compress') {
        $compressed = inet_ntop(inet_pton($ipv6));
        return ['original' => $ipv6, 'compressed' => $compressed];
    } else {
        $expanded = inet_ntop(inet_pton($ipv6));
        // Re-expand to full form
        $parts = explode(':', $expanded);
        $fullParts = [];
        foreach ($parts as $part) {
            $fullParts[] = str_pad($part, 4, '0', STR_PAD_LEFT);
        }
        return ['original' => $ipv6, 'expanded' => implode(':', $fullParts)];
    }
}

function CloudHost247_tool_subnet_calculator($post)
{
    $ip = CloudHost247_tools_sanitize($post['ip'] ?? '', 'ip');
    $mask = (int) ($post['mask'] ?? 24);
    if (!CloudHost247_tools_validate_ipv4($ip)) {
        return ['error' => 'Invalid IPv4 address'];
    }
    if ($mask < 1 || $mask > 32) {
        return ['error' => 'Subnet mask must be 1-32'];
    }

    $ipLong = ip2long($ip);
    $maskLong = -1 << (32 - $mask);
    $network = long2ip($ipLong & $maskLong);
    $broadcast = long2ip($ipLong | (~$maskLong));
    $wildcard = long2ip(~$maskLong);

    $hostBits = 32 - $mask;
    $totalHosts = pow(2, $hostBits);
    $usableHosts = $totalHosts > 2 ? $totalHosts - 2 : 0;
    $firstUsable = long2ip((ip2long($network) & $maskLong) + 1);
    $lastUsable = long2ip((ip2long($network) | (~$maskLong)) - 1);

    return [
        'ip' => $ip,
        'cidr' => $ip . '/' . $mask,
        'subnet_mask' => long2ip($maskLong),
        'wildcard' => $wildcard,
        'network' => $network,
        'broadcast' => $broadcast,
        'first_usable' => $firstUsable,
        'last_usable' => $lastUsable,
        'total_hosts' => $totalHosts,
        'usable_hosts' => $usableHosts,
    ];
}

function CloudHost247_tool_isp_checker($post)
{
    $ip = CloudHost247_tools_sanitize($post['ip'] ?? '', 'ip');
    if (empty($ip)) {
        $ip = CloudHost247_tools_get_client_ip();
    }
    if (!CloudHost247_tools_validate_ip($ip)) {
        return ['error' => 'Invalid IP address'];
    }

    $location = CloudHost247_tool_ip_location(['ip' => $ip]);
    if (isset($location['error'])) {
        return $location;
    }

    return [
        'ip' => $ip,
        'isp' => $location['isp'] ?? 'Unknown',
        'organization' => $location['organization'] ?? 'Unknown',
        'country' => $location['country'] ?? 'Unknown',
        'city' => $location['city'] ?? 'Unknown',
        'asn' => $location['asn'] ?? 'Unknown',
    ];
}

function CloudHost247_tool_domain_to_ip($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $ipv4 = gethostbyname($domain);
    $ipv6 = null;

    // Try to get AAAA record
    $aaaa = dns_get_record($domain, DNS_AAAA);
    if (!empty($aaaa)) {
        $ipv6 = $aaaa[0]['ipv6'] ?? null;
    }

    return [
        'domain' => $domain,
        'ipv4' => $ipv4 !== $domain ? $ipv4 : null,
        'ipv6' => $ipv6,
    ];
}
