<?php
/**
 * CloudHost247 Tools - DNS Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

function CloudHost247_tool_spf_checker($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $records = CloudHost247_tools_dns_query($domain, 'TXT');
    $spfRecords = [];
    $issues = [];
    $warnings = [];

    foreach ($records as $record) {
        if (isset($record['txt']) && stripos($record['txt'], 'v=spf1') !== false) {
            $spfRecords[] = $record['txt'];
        }
    }

    if (empty($spfRecords)) {
        $issues[] = 'No SPF record found';
        return ['domain' => $domain, 'found' => false, 'records' => [], 'issues' => $issues, 'warnings' => $warnings];
    }

    if (count($spfRecords) > 1) {
        $issues[] = 'Multiple SPF records found - only one should exist';
    }

    foreach ($spfRecords as $spf) {
        if (strlen($spf) > 450) {
            $warnings[] = 'SPF record exceeds 450 characters (may cause issues)';
        }
        if (stripos($spf, '+all') !== false) {
            $issues[] = 'SPF uses +all (allows all senders - insecure)';
        }
        if (stripos($spf, '~all') === false && stripos($spf, '-all') === false) {
            $warnings[] = 'No explicit fail mechanism (~all or -all) found';
        }
    }

    return [
        'domain' => $domain,
        'found' => true,
        'records' => $spfRecords,
        'issues' => $issues,
        'warnings' => $warnings,
    ];
}

function CloudHost247_tool_domain_dns_validation($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $types = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'SOA', 'CNAME'];
    $results = [];

    foreach ($types as $type) {
        $records = @dns_get_record($domain, constant('DNS_' . $type));
        $results[$type] = $records ?: [];
    }

    $hasNS = !empty($results['NS']);
    $hasSOA = !empty($results['SOA']);
    $hasA = !empty($results['A']);
    $issues = [];

    if (!$hasNS) $issues[] = 'No NS records found';
    if (!$hasSOA) $issues[] = 'No SOA record found';

    return [
        'domain' => $domain,
        'records' => $results,
        'healthy' => empty($issues),
        'issues' => $issues,
    ];
}

function CloudHost247_tool_reverse_ip_lookup($post)
{
    $ip = CloudHost247_tools_sanitize($post['ip'] ?? '', 'ip');
    if (!CloudHost247_tools_validate_ip($ip)) {
        return ['error' => 'Invalid IP address'];
    }

    $hostname = gethostbyaddr($ip);
    if (!$hostname || $hostname === $ip) {
        return ['ip' => $ip, 'hostname' => null, 'found' => false];
    }

    return ['ip' => $ip, 'hostname' => $hostname, 'found' => true];
}

function CloudHost247_tool_dns_lookup($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    $type = strtoupper(CloudHost247_tools_sanitize($post['type'] ?? 'A', 'string'));
    $validTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'SOA', 'CNAME', 'PTR', 'SRV', 'CAA'];

    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }
    if (!in_array($type, $validTypes)) {
        return ['error' => 'Invalid DNS record type'];
    }

    $records = CloudHost247_tools_dns_query($domain, $type);
    $formatted = [];

    foreach ($records as $record) {
        $row = ['type' => $record['type'], 'ttl' => $record['ttl'] ?? 0];
        switch ($type) {
            case 'A': $row['value'] = $record['ip'] ?? ''; break;
            case 'AAAA': $row['value'] = $record['ipv6'] ?? ''; break;
            case 'MX': $row['value'] = ($record['pri'] ?? 0) . ' ' . ($record['target'] ?? ''); break;
            case 'TXT': $row['value'] = $record['txt'] ?? ''; break;
            case 'NS': $row['value'] = $record['target'] ?? ''; break;
            case 'CNAME': $row['value'] = $record['target'] ?? ''; break;
            case 'SOA': $row['value'] = ($record['rname'] ?? '') . ' (' . ($record['serial'] ?? '') . ')'; break;
            case 'SRV': $row['value'] = ($record['pri'] ?? '') . ' ' . ($record['weight'] ?? '') . ' ' . ($record['port'] ?? '') . ' ' . ($record['target'] ?? ''); break;
            case 'CAA': $row['value'] = ($record['flags'] ?? '') . ' ' . ($record['tag'] ?? '') . ' "' . ($record['value'] ?? '') . '"'; break;
            default: $row['value'] = json_encode($record);
        }
        $formatted[] = $row;
    }

    return ['domain' => $domain, 'type' => $type, 'records' => $formatted, 'count' => count($formatted)];
}

function CloudHost247_tool_cname_lookup($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $records = CloudHost247_tools_dns_query($domain, 'CNAME');
    $formatted = [];
    foreach ($records as $record) {
        $formatted[] = [
            'domain' => $record['host'] ?? $domain,
            'target' => $record['target'] ?? '',
            'ttl' => $record['ttl'] ?? 0,
        ];
    }

    return ['domain' => $domain, 'records' => $formatted, 'count' => count($formatted)];
}

function CloudHost247_tool_ns_lookup($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $records = CloudHost247_tools_dns_query($domain, 'NS');
    $nameservers = [];
    foreach ($records as $record) {
        $nameservers[] = [
            'host' => $record['target'] ?? '',
            'ttl' => $record['ttl'] ?? 0,
        ];
    }

    return ['domain' => $domain, 'nameservers' => $nameservers, 'count' => count($nameservers)];
}

function CloudHost247_tool_mx_lookup($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $records = CloudHost247_tools_dns_query($domain, 'MX');
    $servers = [];
    foreach ($records as $record) {
        $servers[] = [
            'priority' => $record['pri'] ?? 0,
            'target' => $record['target'] ?? '',
            'ttl' => $record['ttl'] ?? 0,
        ];
    }

    usort($servers, function ($a, $b) {
        return $a['priority'] - $b['priority'];
    });

    return ['domain' => $domain, 'servers' => $servers, 'count' => count($servers)];
}

function CloudHost247_tool_dns_propagation($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    $type = strtoupper(CloudHost247_tools_sanitize($post['type'] ?? 'A', 'string'));
    $servers = [
        ['name' => 'Google', 'ip' => '8.8.8.8'],
        ['name' => 'Google 2', 'ip' => '8.8.4.4'],
        ['name' => 'Cloudflare', 'ip' => '1.1.1.1'],
        ['name' => 'Cloudflare 2', 'ip' => '1.0.0.1'],
        ['name' => 'Quad9', 'ip' => '9.9.9.9'],
        ['name' => 'OpenDNS', 'ip' => '208.67.222.222'],
        ['name' => 'OpenDNS 2', 'ip' => '208.67.220.220'],
        ['name' => 'Level3', 'ip' => '209.244.0.3'],
        ['name' => 'Verisign', 'ip' => '64.6.64.6'],
        ['name' => 'DNS.WATCH', 'ip' => '84.200.69.80'],
    ];

    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }
    if (!in_array($type, ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'])) {
        return ['error' => 'Invalid record type'];
    }

    $results = [];
    foreach ($servers as $server) {
        $cmd = 'dig @' . escapeshellarg($server['ip']) . ' ' . escapeshellarg($domain) . ' ' . $type . ' +short';
        $output = CloudHost247_tools_safe_exec($cmd, 5);
        $lines = array_filter(explode("\n", trim($output ?: '')));

        $results[] = [
            'server_name' => $server['name'],
            'server_ip' => $server['ip'],
            'resolved' => !empty($lines),
            'records' => array_values($lines),
        ];
    }

    return ['domain' => $domain, 'type' => $type, 'results' => $results];
}

function CloudHost247_tool_dmarc_lookup($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $records = CloudHost247_tools_dns_query('_dmarc.' . $domain, 'TXT');
    $dmarcRecords = [];
    $valid = false;
    $issues = [];

    foreach ($records as $record) {
        $txt = $record['txt'] ?? '';
        if (stripos($txt, 'v=DMARC1') !== false) {
            $dmarcRecords[] = $txt;
            $valid = true;
            if (stripos($txt, 'p=none') !== false) {
                $issues[] = 'Policy is p=none (monitoring only, no enforcement)';
            }
            if (stripos($txt, 'rua=') === false) {
                $issues[] = 'No aggregate report URI (rua) defined';
            }
        }
    }

    if (empty($dmarcRecords)) {
        $issues[] = 'No DMARC record found';
    }

    return [
        'domain' => $domain,
        'found' => !empty($dmarcRecords),
        'records' => $dmarcRecords,
        'valid' => $valid,
        'issues' => $issues,
    ];
}

function CloudHost247_tool_dns_health($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $checks = [];
    $score = 0;
    $maxScore = 0;

    // Check NS records
    $maxScore++;
    $ns = CloudHost247_tools_dns_query($domain, 'NS');
    if (!empty($ns)) {
        $score++;
        $checks[] = ['test' => 'NS Records', 'status' => 'pass', 'detail' => count($ns) . ' name servers found'];
    } else {
        $checks[] = ['test' => 'NS Records', 'status' => 'fail', 'detail' => 'No name servers found'];
    }

    // Check A record
    $maxScore++;
    $a = CloudHost247_tools_dns_query($domain, 'A');
    if (!empty($a)) {
        $score++;
        $checks[] = ['test' => 'A Record', 'status' => 'pass', 'detail' => 'A record exists'];
    } else {
        $checks[] = ['test' => 'A Record', 'status' => 'warning', 'detail' => 'No A record found'];
    }

    // Check MX
    $maxScore++;
    $mx = CloudHost247_tools_dns_query($domain, 'MX');
    if (!empty($mx)) {
        $score++;
        $checks[] = ['test' => 'MX Records', 'status' => 'pass', 'detail' => count($mx) . ' mail servers found'];
    } else {
        $checks[] = ['test' => 'MX Records', 'status' => 'warning', 'detail' => 'No MX records (email may not work)'];
    }

    // Check SPF
    $maxScore++;
    $txt = CloudHost247_tools_dns_query($domain, 'TXT');
    $hasSpf = false;
    foreach ($txt as $record) {
        if (stripos($record['txt'] ?? '', 'v=spf1') !== false) {
            $hasSpf = true;
            break;
        }
    }
    if ($hasSpf) {
        $score++;
        $checks[] = ['test' => 'SPF Record', 'status' => 'pass', 'detail' => 'SPF record found'];
    } else {
        $checks[] = ['test' => 'SPF Record', 'status' => 'warning', 'detail' => 'No SPF record'];
    }

    // Check DMARC
    $maxScore++;
    $dmarc = CloudHost247_tools_dns_query('_dmarc.' . $domain, 'TXT');
    $hasDmarc = false;
    foreach ($dmarc as $record) {
        if (stripos($record['txt'] ?? '', 'v=DMARC1') !== false) {
            $hasDmarc = true;
            break;
        }
    }
    if ($hasDmarc) {
        $score++;
        $checks[] = ['test' => 'DMARC Record', 'status' => 'pass', 'detail' => 'DMARC record found'];
    } else {
        $checks[] = ['test' => 'DMARC Record', 'status' => 'warning', 'detail' => 'No DMARC record'];
    }

    $percentage = $maxScore > 0 ? round(($score / $maxScore) * 100) : 0;

    return [
        'domain' => $domain,
        'score' => $score,
        'max_score' => $maxScore,
        'percentage' => $percentage,
        'checks' => $checks,
        'healthy' => $percentage >= 80,
    ];
}

function CloudHost247_tool_dmarc_generator($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    $policy = CloudHost247_tools_sanitize($post['policy'] ?? 'none', 'string');
    $pct = (int) ($post['pct'] ?? 100);
    $rua = CloudHost247_tools_sanitize($post['rua'] ?? '', 'email');
    $ruf = CloudHost247_tools_sanitize($post['ruf'] ?? '', 'email');
    $aspf = CloudHost247_tools_sanitize($post['aspf'] ?? 'r', 'string');
    $adkim = CloudHost247_tools_sanitize($post['adkim'] ?? 'r', 'string');

    $record = 'v=DMARC1; p=' . $policy . '; pct=' . $pct;
    if ($rua && CloudHost247_tools_validate_email($rua)) {
        $record .= '; rua=mailto:' . $rua;
    }
    if ($ruf && CloudHost247_tools_validate_email($ruf)) {
        $record .= '; ruf=mailto:' . $ruf;
    }
    $record .= '; aspf=' . $aspf . '; adkim=' . $adkim;

    return [
        'domain' => $domain,
        'record' => $record,
        'dns_entry' => '_dmarc.' . $domain . ' 3600 IN TXT "' . $record . '"',
    ];
}

function CloudHost247_tool_dnskey_lookup($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $records = CloudHost247_tools_dns_query($domain, 'DNSKEY');
    $keys = [];
    foreach ($records as $record) {
        $keys[] = [
            'flags' => $record['flags'] ?? '',
            'protocol' => $record['protocol'] ?? '',
            'algorithm' => $record['algorithm'] ?? '',
            'key' => isset($record['key']) ? substr($record['key'], 0, 50) . '...' : '',
        ];
    }

    return ['domain' => $domain, 'keys' => $keys, 'count' => count($keys)];
}

function CloudHost247_tool_ds_record_lookup($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $records = CloudHost247_tools_dns_query($domain, 'DS');
    $dsRecords = [];
    foreach ($records as $record) {
        $dsRecords[] = [
            'key_tag' => $record['key_tag'] ?? '',
            'algorithm' => $record['algorithm'] ?? '',
            'digest_type' => $record['digest_type'] ?? '',
            'digest' => $record['digest'] ?? '',
        ];
    }

    return ['domain' => $domain, 'records' => $dsRecords, 'count' => count($dsRecords)];
}

function CloudHost247_tool_dkim_checker($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    $selector = CloudHost247_tools_sanitize($post['selector'] ?? 'default', 'string');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $dkimDomain = $selector . '._domainkey.' . $domain;
    $records = CloudHost247_tools_dns_query($dkimDomain, 'TXT');
    $found = false;
    $issues = [];
    $recordData = '';

    foreach ($records as $record) {
        $txt = $record['txt'] ?? '';
        if (stripos($txt, 'v=DKIM1') !== false) {
            $found = true;
            $recordData = $txt;
            if (stripos($txt, 'k=rsa') === false) {
                $issues[] = 'Key type not explicitly set to RSA';
            }
            if (stripos($txt, 'p=') === false) {
                $issues[] = 'No public key found';
            }
        }
    }

    if (!$found) {
        $issues[] = 'No DKIM record found for selector: ' . $selector;
    }

    return [
        'domain' => $domain,
        'selector' => $selector,
        'found' => $found,
        'record' => $recordData,
        'issues' => $issues,
    ];
}
