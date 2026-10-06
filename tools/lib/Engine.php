<?php
namespace CloudHost247\Tools;

/** Server-side tool executor. Browser-only tools are refused here so secrets never arrive. */
final class Engine
{
    public static function run($slug, array $input, array $context = array())
    {
        $tool = Catalog::find($slug);
        if (!$tool || empty($tool['enabled'])) {
            return self::fail('This tool is not available.');
        }
        if (!empty($tool['maintenance'])) {
            return self::fail($tool['maintenance']);
        }
        if ($tool['mode'] !== 'server') {
            Guard::log('local-rejected', $slug);
            return self::fail('This tool runs in your browser and is not accepted by the server.');
        }
        $limit = isset($tool['ratePerMinute']) ? (int) $tool['ratePerMinute'] : self::defaultLimit($tool['handler']);
        $ip = isset($context['ip']) ? $context['ip'] : Guard::clientIp();
        if (!Guard::rateLimit($ip, $slug, $limit)) {
            return self::fail('Rate limit reached. Wait a minute and try again.', 429);
        }
        $started = microtime(true);
        try {
            $result = self::dispatch($tool, $input, $context);
        } catch (\Throwable $e) {
            Guard::log('handler-error', $slug);
            return self::fail('The check could not be completed.');
        }
        $result['slug'] = $slug;
        $result['checkedAt'] = gmdate('c');
        if (!isset($result['elapsedMs'])) {
            $result['elapsedMs'] = (int) round((microtime(true) - $started) * 1000);
        }
        return $result;
    }

    private static function dispatch(array $tool, array $input, array $context)
    {
        $handler = $tool['handler'];
        $options = isset($tool['options']) ? $tool['options'] : array();
        switch ($handler) {
            case 'dns_lookup': return self::dnsLookup($input, isset($options['type']) ? $options['type'] : null);
            case 'dns_checker': return self::dnsChecker($input);
            case 'dns_propagation': return self::propagation($input);
            case 'dns_validation': return self::validation($input);
            case 'dns_health': return self::health($input);
            case 'spf': return self::spf($input);
            case 'dmarc': return self::dmarc($input);
            case 'dkim': return self::dkim($input);
            case 'bimi': return self::bimi($input);
            case 'reverse_ip': return self::ptr($input, true);
            case 'ip_hostname': return self::ptr($input, false);
            case 'domain_to_ip': return self::domainToIp($input);
            case 'ping': return self::ping($input, isset($options['family']) ? $options['family'] : 'any');
            case 'traceroute': return self::traceroute($input);
            case 'my_ip': return self::myIp($context);
            case 'isp': return self::isp($context);
            case 'ip_location': return self::location($input);
            case 'ip_whois': return self::ipWhois($input, isset($options['family']) ? $options['family'] : 'any');
            case 'domain_whois': return self::domainWhois($input);
            case 'asn': return self::asn($input);
            case 'ip_blacklist': return self::blacklist($input, 'ip');
            case 'email_blacklist': return self::blacklist($input, 'domain');
            case 'ipv6_compat': return self::ipv6Compat($input);
            case 'http_headers': return self::headers($input);
            case 'server_os': return self::serverOs($input);
            case 'smtp': return self::smtp($input);
            case 'broken_links': return self::links($input, true);
            case 'link_analyzer': return self::links($input, false);
            case 'open_graph': return self::openGraph($input);
            case 'pagerank': return self::pagerank($input);
            case 'email_verify': return self::emailVerify($input);
            case 'port': return self::port($input);
            case 'ssl': return self::ssl($input);
            case 'name_check': return self::nameCheck($input);
            case 'domain_search': return self::domainSearch($input);
            case 'speed': return self::speed($input);
            default: return self::fail('This tool has no server handler.');
        }
    }

    private static function dnsLookup(array $input, $fixed)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : (isset($input['target']) ? $input['target'] : ''));
        if ($name === null && !empty($input['target']) && Guard::isPublicIp(trim($input['target']))) {
            $name = trim($input['target']);
        }
        if ($name === null) {
            return self::fail('Enter a valid public hostname.');
        }
        $type = $fixed ? $fixed : strtoupper(isset($input['type']) ? (string) $input['type'] : 'A');
        $allowed = array('A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA', 'SRV', 'PTR', 'DNSKEY', 'DS');
        if (!in_array($type, $allowed, true)) {
            return self::fail('That record type is not supported.');
        }
        $query = Net::doh($name, $type);
        if (!$query['ok']) {
            return self::fail($query['error']);
        }
        $rows = array();
        foreach ($query['answers'] as $answer) {
            $rows[] = array('Record' => $answer['type'], 'Value' => $answer['value'], 'TTL' => $answer['ttl'], 'Resolver' => $query['resolver']);
        }
        return self::ok($rows ? count($rows) . ' ' . $type . ' answer(s) from ' . $query['resolver'] : 'No ' . $type . ' records in the response.', $rows, array(
            'Status code ' . $query['status'] . ' is the resolver RCODE. An empty answer is not the same as a transport failure.',
        ), $query['elapsedMs']);
    }

    private static function dnsChecker(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a valid domain.');
        }
        $rows = array();
        foreach (array('A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA') as $type) {
            $query = Net::doh($name, $type);
            if (!$query['ok']) {
                $rows[] = array('Type' => $type, 'Status' => 'Failed', 'Value' => $query['error'], 'TTL' => '', 'Resolver' => '');
                continue;
            }
            if (!$query['answers']) {
                $rows[] = array('Type' => $type, 'Status' => 'No data', 'Value' => 'Resolver returned no ' . $type . ' record', 'TTL' => '', 'Resolver' => $query['resolver']);
                continue;
            }
            foreach ($query['answers'] as $answer) {
                $rows[] = array('Type' => $type, 'Status' => 'Answer', 'Value' => $answer['value'], 'TTL' => $answer['ttl'], 'Resolver' => $query['resolver']);
            }
        }
        return self::ok('DNS check completed for ' . $name, $rows, array('Each row is one answer from the resolver that was queried.'));
    }

    private static function propagation(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        $type = strtoupper(isset($input['type']) ? (string) $input['type'] : 'A');
        if ($name === null || !in_array($type, array('A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT'), true)) {
            return self::fail('Enter a domain and a supported record type.');
        }
        $rows = array();
        $ok = 0;
        $failed = 0;
        foreach (Net::propagationResolvers() as $resolver) {
            $query = Net::doh($name, $type, $resolver['url']);
            $stamp = gmdate('c');
            if (!$query['ok']) {
                $failed++;
                $rows[] = array('Resolver' => $resolver['name'], 'Location' => $resolver['location'], 'Status' => 'Failed', 'Response' => $query['error'], 'Time' => $query['elapsedMs'] . ' ms', 'Checked' => $stamp);
                continue;
            }
            $ok++;
            $values = array();
            foreach ($query['answers'] as $answer) {
                $values[] = $answer['value'];
            }
            $rows[] = array(
                'Resolver' => $resolver['name'],
                'Location' => $resolver['location'],
                'Status' => $values ? 'Answer' : 'No data',
                'Response' => $values ? implode('; ', $values) : 'No ' . $type . ' data',
                'Time' => $query['elapsedMs'] . ' ms',
                'Checked' => $stamp,
            );
        }
        return self::ok($ok . ' successful, ' . $failed . ' failed', $rows, array(
            'These are the resolvers CloudHost247 queried. Anycast networks do not prove country-level propagation.',
            'Last checked ' . gmdate('c') . '. Propagation status is the comparison of these responses only.',
        ));
    }

    private static function validation(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a valid domain.');
        }
        $rows = array();
        foreach (array('NS' => 'Delegation', 'SOA' => 'Authority', 'A' => 'IPv4 address', 'AAAA' => 'IPv6 address') as $type => $label) {
            $query = Net::doh($name, $type);
            $present = $query['ok'] && !empty($query['answers']);
            $rows[] = array('Check' => $label, 'Status' => !$query['ok'] ? 'Failed' : ($present ? 'Present' : 'Missing'), 'Detail' => !$query['ok'] ? $query['error'] : ($present ? $query['answers'][0]['value'] : 'No ' . $type . ' record'));
        }
        return self::ok('Validation finished for ' . $name, $rows, array('A website can be valid with A or AAAA. Missing both is a problem; missing one is not.'));
    }

    private static function health(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a valid domain.');
        }
        $checks = array(
            array('NS', $name, 'Name servers'),
            array('A', $name, 'IPv4'),
            array('AAAA', $name, 'IPv6'),
            array('MX', $name, 'Mail exchangers'),
            array('TXT', $name, 'TXT'),
            array('TXT', '_dmarc.' . $name, 'DMARC'),
        );
        $rows = array();
        foreach ($checks as $check) {
            $query = Net::doh($check[1], $check[0]);
            $rows[] = array(
                'Check' => $check[2],
                'Status' => !$query['ok'] ? 'Error' : ($query['answers'] ? 'Found' : 'Not found'),
                'Detail' => !$query['ok'] ? $query['error'] : ($query['answers'] ? $query['answers'][0]['value'] : 'No data'),
            );
        }
        return self::ok('Health checks finished', $rows, array('This is not a cryptographic DNSSEC validation.'));
    }

    private static function spf(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a valid domain.');
        }
        $query = Net::doh($name, 'TXT');
        if (!$query['ok']) {
            return self::fail($query['error']);
        }
        $records = array();
        foreach ($query['answers'] as $answer) {
            $value = trim($answer['value'], '"');
            if (stripos($value, 'v=spf1') === 0) {
                $records[] = $value;
            }
        }
        $notes = array();
        if (count($records) > 1) {
            $notes[] = 'More than one SPF record was published. Receivers may reject the policy.';
        }
        if (!$records) {
            $notes[] = 'No SPF record was found.';
        }
        $lookups = 0;
        foreach ($records as $record) {
            preg_match_all('/(?:include:|a:|mx:|ptr:|exists:|redirect=)/i', $record, $matches);
            $lookups += count($matches[0]);
        }
        if ($lookups > 10) {
            $notes[] = 'The visible mechanisms already imply more than 10 DNS lookups before nested includes are expanded.';
        }
        $rows = array();
        foreach ($records as $record) {
            $rows[] = array('Record' => $record, 'Lookup mechanisms' => $lookups);
        }
        return self::ok($records ? 'SPF record found' : 'No SPF record', $rows, $notes);
    }

    private static function dmarc(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a valid domain.');
        }
        $query = Net::doh('_dmarc.' . $name, 'TXT');
        if (!$query['ok']) {
            return self::fail($query['error']);
        }
        $rows = array();
        foreach ($query['answers'] as $answer) {
            $value = trim($answer['value'], '"');
            if (stripos($value, 'v=DMARC1') === false) {
                continue;
            }
            $tags = array();
            foreach (explode(';', $value) as $part) {
                $part = trim($part);
                if ($part === '' || strpos($part, '=') === false) {
                    continue;
                }
                list($key, $val) = explode('=', $part, 2);
                $tags[strtolower(trim($key))] = trim($val);
            }
            $rows[] = array('Record' => $value, 'Policy' => isset($tags['p']) ? $tags['p'] : 'missing', 'RUA' => isset($tags['rua']) ? $tags['rua'] : '');
        }
        return self::ok($rows ? 'DMARC record found' : 'No DMARC record', $rows, array('A missing record means receivers have no published DMARC policy to follow.'));
    }

    private static function dkim(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        $selector = isset($input['selector']) ? strtolower(trim($input['selector'])) : '';
        if ($name === null || !preg_match('/^[a-z0-9][a-z0-9_-]{0,62}$/', $selector)) {
            return self::fail('Enter a domain and a selector. Selectors are not guessed.');
        }
        $host = $selector . '._domainkey.' . $name;
        $query = Net::doh($host, 'TXT');
        if (!$query['ok']) {
            return self::fail($query['error']);
        }
        $rows = array();
        foreach ($query['answers'] as $answer) {
            $rows[] = array('Host' => $host, 'Value' => trim($answer['value'], '"'), 'TTL' => $answer['ttl']);
        }
        return self::ok($rows ? 'DKIM record found' : 'No DKIM TXT record at that selector', $rows, array('This does not verify a signature. It only retrieves the published key record.'));
    }

    private static function bimi(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a valid domain.');
        }
        $selector = isset($input['selector']) && $input['selector'] !== '' ? preg_replace('/[^a-z0-9-]/', '', strtolower($input['selector'])) : 'default';
        $host = $selector . '._bimi.' . $name;
        $query = Net::doh($host, 'TXT');
        $rows = array();
        if ($query['ok']) {
            foreach ($query['answers'] as $answer) {
                $rows[] = array('Host' => $host, 'Record' => trim($answer['value'], '"'));
            }
        }
        $notes = array('A BIMI logo URL is not brand verification.');
        if (!empty($input['logo']) && Guard::publicUrl($input['logo'])) {
            $logo = Guard::publicUrl($input['logo']);
            $rows[] = array('Draft' => 'v=BIMI1; l=' . $logo['url'] . ';', 'Host' => $host, 'Record' => 'Not published by this tool');
            $notes[] = 'The draft is for you to publish. CloudHost247 did not change DNS.';
        }
        if (!$query['ok']) {
            $notes[] = 'Lookup failed: ' . $query['error'];
        }
        return self::ok($rows ? 'BIMI result' : 'No BIMI record found', $rows, $notes);
    }

    private static function ptr(array $input, $reverseNote)
    {
        $ip = trim(isset($input['target']) ? $input['target'] : '');
        if (!Guard::isPublicIp($ip)) {
            return self::fail('Enter a public IP address.');
        }
        $name = self::reverseName($ip);
        if ($name === null) {
            return self::fail('That address cannot be reversed.');
        }
        $query = Net::doh($name, 'PTR');
        if (!$query['ok']) {
            return self::fail($query['error']);
        }
        $rows = array();
        foreach ($query['answers'] as $answer) {
            $rows[] = array('PTR' => $answer['value'], 'TTL' => $answer['ttl'], 'Resolver' => $query['resolver']);
        }
        $notes = array('PTR is the hostname published for this address.');
        if ($reverseNote) {
            $notes[] = 'Neighbor or co-hosted domain lists are not queried. No provider is configured, so none are invented.';
        }
        return self::ok($rows ? 'PTR found' : 'No PTR record', $rows, $notes);
    }

    private static function domainToIp(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a valid domain.');
        }
        $rows = array();
        foreach (array('A', 'AAAA') as $type) {
            $query = Net::doh($name, $type);
            if (!$query['ok']) {
                $rows[] = array('Type' => $type, 'Address' => $query['error'], 'TTL' => '');
                continue;
            }
            if (!$query['answers']) {
                $rows[] = array('Type' => $type, 'Address' => 'No data', 'TTL' => '');
            }
            foreach ($query['answers'] as $answer) {
                $rows[] = array('Type' => $type, 'Address' => $answer['value'], 'TTL' => $answer['ttl']);
            }
        }
        return self::ok('Resolution finished', $rows, array('Addresses can change with TTL and resolver.'));
    }

    private static function ping(array $input, $family)
    {
        $target = Guard::hostnameOrIp(isset($input['target']) ? $input['target'] : '');
        if ($target === null) {
            return self::fail('Enter a public hostname or IP address.');
        }
        $ips = Guard::resolvePublic($target);
        $ips = array_values(array_filter($ips, function ($ip) use ($family) {
            $v6 = strpos($ip, ':') !== false;
            if ($family === 'ipv4') {
                return !$v6;
            }
            if ($family === 'ipv6') {
                return $v6;
            }
            return true;
        }));
        if (!$ips) {
            return self::fail('No public ' . $family . ' address was found, or the name is not allowed.');
        }
        $rows = array();
        foreach (array_slice($ips, 0, 2) as $ip) {
            foreach (array(443, 80) as $port) {
                $probe = Net::tcp($ip, $port, 4);
                $rows[] = array('Address' => $ip, 'Probe' => 'TCP/' . $port, 'Status' => $probe['ok'] ? 'Open' : 'No response', 'Time' => $probe['elapsedMs'] . ' ms', 'Detail' => $probe['ok'] ? 'Connected' : $probe['error']);
            }
        }
        return self::ok('TCP reachability measured', $rows, array('ICMP echo is not used. A closed TCP port is not proof the host is offline.'));
    }

    private static function traceroute(array $input)
    {
        $ping = self::ping($input, 'any');
        if (empty($ping['ok'])) {
            return $ping;
        }
        $notes = $ping['notes'];
        $notes[] = 'Hop-by-hop ICMP traceroute is unavailable in this runtime because raw ICMP is not permitted. No hops were invented.';
        $ping['summary'] = 'Destination reachability only';
        $ping['notes'] = $notes;
        return $ping;
    }

    private static function myIp(array $context)
    {
        $ip = isset($context['ip']) ? $context['ip'] : Guard::clientIp();
        return self::ok('Address observed by this service', array(array('IP' => $ip, 'Family' => strpos($ip, ':') !== false ? 'IPv6' : 'IPv4')), array('Proxy headers are ignored unless CH247_TRUST_PROXY=1 is set on the server.'));
    }

    private static function isp(array $context)
    {
        $ip = isset($context['ip']) ? $context['ip'] : Guard::clientIp();
        if (!Guard::isPublicIp($ip)) {
            return self::fail('The observed address is not a public IP, so no ISP lookup was performed.');
        }
        return self::location(array('target' => $ip));
    }

    private static function location(array $input)
    {
        $ip = trim(isset($input['target']) ? $input['target'] : '');
        if (!Guard::isPublicIp($ip)) {
            return self::fail('Enter a public IP address.');
        }
        $rdap = self::rdap('ip/' . rawurlencode($ip));
        $rows = array();
        if ($rdap['ok']) {
            $rows[] = array('Section' => 'Registration', 'Field' => 'Name', 'Value' => isset($rdap['json']['name']) ? $rdap['json']['name'] : '');
            $rows[] = array('Section' => 'Registration', 'Field' => 'Handle', 'Value' => isset($rdap['json']['handle']) ? $rdap['json']['handle'] : '');
            $rows[] = array('Section' => 'Registration', 'Field' => 'Type', 'Value' => isset($rdap['json']['type']) ? $rdap['json']['type'] : '');
            $rows[] = array('Section' => 'Registration', 'Field' => 'Country', 'Value' => isset($rdap['json']['country']) ? $rdap['json']['country'] : '');
        } else {
            $rows[] = array('Section' => 'Registration', 'Field' => 'RDAP', 'Value' => $rdap['error']);
        }
        $geo = self::geo($ip);
        if ($geo['ok']) {
            foreach (array('city', 'region', 'country', 'isp', 'org') as $field) {
                if (!empty($geo['json'][$field])) {
                    $rows[] = array('Section' => 'Estimated geolocation', 'Field' => $field, 'Value' => $geo['json'][$field]);
                }
            }
        } else {
            $rows[] = array('Section' => 'Estimated geolocation', 'Field' => 'Status', 'Value' => 'Unavailable: ' . $geo['error']);
        }
        return self::ok('IP information collected', $rows, array('Registration data and estimated geolocation are different things. A city estimate is not a physical location of a person.'));
    }

    private static function ipWhois(array $input, $family)
    {
        $ip = trim(isset($input['target']) ? $input['target'] : '');
        if (!Guard::isPublicIp($ip)) {
            return self::fail('Enter a public IP address.');
        }
        if ($family === 'ipv6' && strpos($ip, ':') === false) {
            return self::fail('Enter an IPv6 address for this tool.');
        }
        $rdap = self::rdap('ip/' . rawurlencode($ip));
        if (!$rdap['ok']) {
            return self::fail($rdap['error']);
        }
        return self::ok('RDAP result', self::rdapRows($rdap['json']), array('Source: ' . $rdap['url']));
    }

    private static function domainWhois(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a valid domain.');
        }
        $rdap = self::rdap('domain/' . rawurlencode($name));
        if (!$rdap['ok']) {
            return self::fail($rdap['error']);
        }
        return self::ok('RDAP domain result', self::rdapRows($rdap['json']), array('RDAP is the source. A missing record is not a promise you can register the name.'));
    }

    private static function asn(array $input)
    {
        $target = strtoupper(trim(isset($input['target']) ? $input['target'] : ''));
        $target = preg_replace('/^AS/', '', $target);
        if (preg_match('/^\d{1,10}$/', $target)) {
            $rdap = self::rdap('autnum/' . $target);
        } elseif (Guard::isPublicIp($target)) {
            $rdap = self::rdap('ip/' . rawurlencode($target));
        } else {
            return self::fail('Enter an ASN or a public IP address.');
        }
        if (!$rdap['ok']) {
            return self::fail($rdap['error']);
        }
        return self::ok('ASN registration result', self::rdapRows($rdap['json']), array('Source: ' . $rdap['url']));
    }

    private static function blacklist(array $input, $kind)
    {
        if ($kind === 'ip') {
            $ip = trim(isset($input['target']) ? $input['target'] : '');
            if (!Guard::isPublicIp($ip) || strpos($ip, ':') !== false) {
                return self::fail('Enter a public IPv4 address. IPv6 DNSBL coverage is not claimed.');
            }
            $parts = explode('.', $ip);
            $queryName = implode('.', array_reverse($parts));
            $zones = array('zen.spamhaus.org', 'bl.spamcop.net', 'b.barracudacentral.org', 'dnsbl.sorbs.net', 'psbl.surriel.com');
        } else {
            $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
            if ($name === null) {
                return self::fail('Enter a domain.');
            }
            $queryName = $name;
            $zones = array('dbl.spamhaus.org', 'multi.surbl.org');
        }
        $rows = array();
        foreach ($zones as $zone) {
            $query = Net::doh($queryName . '.' . $zone, 'A');
            if (!$query['ok']) {
                $rows[] = array('List' => $zone, 'Status' => 'Query failed', 'Answer' => $query['error']);
                continue;
            }
            $listed = false;
            $refused = false;
            $values = array();
            foreach ($query['answers'] as $answer) {
                $values[] = $answer['value'];
                if (strpos($answer['value'], '127.255.255.') === 0) {
                    $refused = true;
                } elseif (strpos($answer['value'], '127.') === 0) {
                    $listed = true;
                }
            }
            $rows[] = array('List' => $zone, 'Status' => $refused ? 'Resolver refused' : ($listed ? 'Listed' : 'Not listed'), 'Answer' => $values ? implode(', ', $values) : 'No A record');
        }
        return self::ok('Block-list queries finished', $rows, array('A result describes these lists only. It is not a reputation guarantee.'));
    }

    private static function ipv6Compat(array $input)
    {
        $name = Guard::domain(isset($input['domain']) ? $input['domain'] : '');
        if ($name === null) {
            return self::fail('Enter a domain.');
        }
        $a = Net::doh($name, 'A');
        $aaaa = Net::doh($name, 'AAAA');
        $rows = array(
            array('Check' => 'A', 'Status' => !empty($a['answers']) ? 'Published' : 'Not published', 'Detail' => !empty($a['answers']) ? $a['answers'][0]['value'] : 'No IPv4 address'),
            array('Check' => 'AAAA', 'Status' => !empty($aaaa['answers']) ? 'Published' : 'Not published', 'Detail' => !empty($aaaa['answers']) ? $aaaa['answers'][0]['value'] : 'No IPv6 address'),
        );
        if (!empty($aaaa['answers'][0]['value']) && Guard::isPublicIp($aaaa['answers'][0]['value'])) {
            $tls = Net::certificate($name, $aaaa['answers'][0]['value']);
            $rows[] = array('Check' => 'HTTPS over IPv6', 'Status' => $tls['ok'] ? 'Handshake completed' : 'Not completed', 'Detail' => $tls['ok'] ? $tls['subject'] : $tls['error']);
        }
        return self::ok('IPv6 evidence collected', $rows, array('Publishing AAAA is not the same as every visitor being able to use IPv6.'));
    }

    private static function headers(array $input)
    {
        $url = Guard::publicUrl(isset($input['url']) ? $input['url'] : '');
        if ($url === null) {
            return self::fail('Enter an http or https URL on a public host.');
        }
        $fetch = self::fetch($url['url'], 3);
        if (!$fetch['ok']) {
            return self::fail($fetch['error']);
        }
        $rows = array(array('Field' => 'Final URL', 'Value' => $fetch['url']), array('Field' => 'Status', 'Value' => (string) $fetch['status']));
        foreach ($fetch['headers'] as $header) {
            $rows[] = array('Field' => $header[0], 'Value' => $header[1]);
        }
        return self::ok('Headers collected', $rows, array('Only the response headers are shown. The body was discarded after a size limit.'));
    }

    private static function serverOs(array $input)
    {
        $headers = self::headers($input);
        if (empty($headers['ok'])) {
            return $headers;
        }
        $server = '';
        $powered = '';
        foreach ($headers['rows'] as $row) {
            if (strtolower($row['Field']) === 'server') {
                $server = $row['Value'];
            }
            if (strtolower($row['Field']) === 'x-powered-by') {
                $powered = $row['Value'];
            }
        }
        $guess = 'Not disclosed';
        $blob = strtolower($server . ' ' . $powered);
        foreach (array('ubuntu', 'debian', 'centos', 'windows', 'cloudlinux', 'nginx', 'apache', 'iis', 'litespeed') as $token) {
            if (strpos($blob, $token) !== false) {
                $guess = $token . ' (mentioned in a header)';
                break;
            }
        }
        $headers['rows'][] = array('Field' => 'Inference', 'Value' => $guess);
        $headers['notes'][] = 'This is an inference from headers, not an authoritative operating-system discovery.';
        $headers['summary'] = 'Header inference: ' . $guess;
        return $headers;
    }

    private static function smtp(array $input)
    {
        $host = Guard::hostnameOrIp(isset($input['host']) ? $input['host'] : '');
        $port = (int) (isset($input['port']) ? $input['port'] : 25);
        if ($host === null || !in_array($port, array(25, 465, 587), true)) {
            return self::fail('Enter a public mail host and port 25, 465 or 587.');
        }
        $ips = Guard::resolvePublic($host);
        if (!$ips) {
            return self::fail('The host did not resolve to a public address.');
        }
        $banner = Net::readBanner($ips[0], $port, '', 6);
        if (!$banner['ok']) {
            return self::fail($banner['error']);
        }
        $ehlo = Net::readBanner($ips[0], $port, "EHLO cloudhost247.invalid\r\nQUIT\r\n", 6);
        return self::ok('SMTP banner collected', array(
            array('Host' => $ips[0], 'Port' => $port, 'Banner' => $banner['banner']),
            array('Host' => $ips[0], 'Port' => $port, 'EHLO' => isset($ehlo['banner']) ? $ehlo['banner'] : ''),
        ), array('No authentication was attempted. A banner does not prove a mailbox exists.'));
    }

    private static function links(array $input, $checkStatus)
    {
        $url = Guard::publicUrl(isset($input['url']) ? $input['url'] : '');
        if ($url === null) {
            return self::fail('Enter a public http(s) URL.');
        }
        $fetch = self::fetch($url['url'], 2, true);
        if (!$fetch['ok']) {
            return self::fail($fetch['error']);
        }
        preg_match_all('/<a\s[^>]*href\s*=\s*([\'"])(.*?)\1/i', $fetch['body'], $matches);
        $hrefs = array_slice(array_unique($matches[2]), 0, 20);
        $rows = array();
        $internal = 0;
        $external = 0;
        foreach ($hrefs as $href) {
            if ($href === '' || $href[0] === '#' || stripos($href, 'javascript:') === 0 || stripos($href, 'mailto:') === 0) {
                continue;
            }
            $absolute = self::absoluteUrl($fetch['url'], $href);
            $parsed = $absolute ? Guard::publicUrl($absolute) : null;
            $kind = $parsed && $parsed['host'] === $url['host'] ? 'Internal' : 'External';
            if ($kind === 'Internal') {
                $internal++;
            } else {
                $external++;
            }
            $status = '';
            if ($checkStatus && $parsed && count($rows) < 12) {
                $probe = self::fetch($parsed['url'], 0);
                $status = $probe['ok'] ? (string) $probe['status'] : $probe['error'];
            }
            $rows[] = array('Link' => $absolute ?: $href, 'Kind' => $kind, 'Status' => $status);
        }
        $notes = array('Only the first page was read. This is not a site crawl.');
        if (!$checkStatus) {
            $notes[] = $internal . ' internal and ' . $external . ' external links were classified from the anchors found.';
        }
        return self::ok(count($rows) . ' links inspected', $rows, $notes);
    }

    private static function openGraph(array $input)
    {
        $url = Guard::publicUrl(isset($input['url']) ? $input['url'] : '');
        if ($url === null) {
            return self::fail('Enter a public URL.');
        }
        $fetch = self::fetch($url['url'], 2, true);
        if (!$fetch['ok']) {
            return self::fail($fetch['error']);
        }
        preg_match_all('/<meta[^>]+>/i', $fetch['body'], $tags);
        $rows = array();
        foreach ($tags[0] as $tag) {
            if (!preg_match('/(?:property|name)\s*=\s*([\'"])(og:[^\'"]+|twitter:[^\'"]+)\1/i', $tag, $key)) {
                continue;
            }
            if (!preg_match('/content\s*=\s*([\'"])(.*?)\1/i', $tag, $value)) {
                continue;
            }
            $rows[] = array('Tag' => $key[2], 'Content' => html_entity_decode($value[2], ENT_QUOTES, 'UTF-8'));
        }
        return self::ok($rows ? count($rows) . ' social tags' : 'No Open Graph or Twitter tags found', $rows, array('Missing tags are reported as missing. Nothing is filled in.'));
    }

    private static function pagerank(array $input)
    {
        $headers = self::headers($input);
        if (empty($headers['ok'])) {
            return $headers;
        }
        $fetch = self::fetch(Guard::publicUrl($input['url'])['url'], 2, true);
        $title = '';
        $robots = '';
        if ($fetch['ok'] && preg_match('/<title[^>]*>(.*?)<\/title>/is', $fetch['body'], $match)) {
            $title = trim(html_entity_decode(strip_tags($match[1]), ENT_QUOTES, 'UTF-8'));
        }
        if ($fetch['ok'] && preg_match('/<meta[^>]+name=[\'"]robots[\'"][^>]*>/i', $fetch['body'], $match)) {
            $robots = $match[0];
        }
        $headers['rows'][] = array('Field' => 'Title', 'Value' => $title !== '' ? $title : 'No title found');
        $headers['rows'][] = array('Field' => 'Robots meta', 'Value' => $robots !== '' ? $robots : 'Not present');
        $headers['rows'][] = array('Field' => 'PageRank', 'Value' => 'Not available');
        $headers['summary'] = 'No PageRank score is available';
        $headers['notes'][] = 'Google retired the public PageRank API. CloudHost247 does not estimate or invent a score.';
        return $headers;
    }

    private static function emailVerify(array $input)
    {
        $email = strtolower(trim(isset($input['email']) ? $input['email'] : ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
            return self::fail('Enter an email address with a normal format.');
        }
        $domain = substr(strrchr($email, '@'), 1);
        $mx = Net::doh($domain, 'MX');
        $a = Net::doh($domain, 'A');
        $disposable = array('mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com');
        $rows = array(
            array('Check' => 'Syntax', 'Status' => 'Accepted', 'Detail' => 'Format only'),
            array('Check' => 'MX', 'Status' => !empty($mx['answers']) ? 'Published' : 'Not published', 'Detail' => !empty($mx['answers']) ? $mx['answers'][0]['value'] : 'No MX'),
            array('Check' => 'A fallback', 'Status' => !empty($a['answers']) ? 'Published' : 'Not published', 'Detail' => !empty($a['answers']) ? $a['answers'][0]['value'] : 'No A'),
            array('Check' => 'Known disposable domain', 'Status' => in_array($domain, $disposable, true) ? 'Matched sample' : 'Not in sample', 'Detail' => 'Sample list only'),
        );
        return self::ok('Address was not confirmed as deliverable', $rows, array('SMTP RCPT probing is not performed. A mailbox may still reject mail.'));
    }

    private static function port(array $input)
    {
        $host = Guard::hostnameOrIp(isset($input['host']) ? $input['host'] : '');
        $port = (int) (isset($input['port']) ? $input['port'] : 0);
        if ($host === null || $port < 1 || $port > 65535) {
            return self::fail('Enter a public host and a TCP port from 1 to 65535.');
        }
        $ips = Guard::resolvePublic($host);
        if (!$ips) {
            return self::fail('The destination is not a public address.');
        }
        $probe = Net::tcp($ips[0], $port, 4);
        return self::ok($probe['ok'] ? 'Port accepted a TCP connection' : 'No TCP connection', array(array(
            'Address' => $ips[0], 'Port' => $port, 'Status' => $probe['ok'] ? 'Open' : 'Closed or filtered', 'Time' => $probe['elapsedMs'] . ' ms',
        )), array('One public destination and one port were tested. Internal networks are refused.'));
    }

    private static function ssl(array $input)
    {
        $host = Guard::domain(isset($input['host']) ? $input['host'] : '');
        if ($host === null) {
            return self::fail('Enter a public hostname.');
        }
        $ips = Guard::resolvePublic($host);
        if (!$ips) {
            return self::fail('The hostname did not resolve to a public address.');
        }
        $cert = Net::certificate($host, $ips[0]);
        if (!$cert['ok']) {
            return self::fail($cert['error']);
        }
        return self::ok($cert['expired'] ? 'Certificate is expired' : 'Certificate presented', array(
            array('Subject' => $cert['subject'], 'Issuer' => $cert['issuer'], 'From' => $cert['validFrom'], 'Until' => $cert['validTo'], 'Names' => implode(', ', $cert['names'])),
        ), array('The certificate was retrieved from ' . $ips[0] . ' with name verification.'));
    }

    private static function nameCheck(array $input)
    {
        $name = strtolower(trim(isset($input['name']) ? $input['name'] : ''));
        if (!preg_match('/^[a-z0-9][a-z0-9-]{1,40}$/', $name)) {
            return self::fail('Use 2–41 letters, numbers or hyphens.');
        }
        $rows = array(array('Check' => 'Format', 'Status' => 'Accepted', 'Detail' => $name));
        foreach (array('com', 'net', 'org') as $tld) {
            $query = Net::doh($name . '.' . $tld, 'NS');
            $rows[] = array('Check' => $name . '.' . $tld, 'Status' => !empty($query['answers']) ? 'Resolves' : 'No NS data', 'Detail' => !empty($query['answers']) ? $query['answers'][0]['value'] : 'Not proof of availability');
        }
        return self::ok('Name format accepted', $rows, array('Social networks were not queried. Domain resolution is not a registration guarantee.'));
    }

    private static function domainSearch(array $input)
    {
        $name = Guard::domain(isset($input['name']) ? $input['name'] : (isset($input['domain']) ? $input['domain'] : ''));
        if ($name === null) {
            return self::fail('Enter a domain such as example.com.');
        }
        $rdap = self::rdap('domain/' . rawurlencode($name));
        $ns = Net::doh($name, 'NS');
        $rows = array(
            array('Source' => 'RDAP', 'Status' => $rdap['ok'] ? 'Record found' : 'No record returned', 'Detail' => $rdap['ok'] ? (isset($rdap['json']['ldhName']) ? $rdap['json']['ldhName'] : 'See handle') : $rdap['error']),
            array('Source' => 'DNS NS', 'Status' => !empty($ns['answers']) ? 'Published' : 'Not published', 'Detail' => !empty($ns['answers']) ? $ns['answers'][0]['value'] : 'No nameserver data'),
        );
        return self::ok('Search evidence collected', $rows, array('Register the name from the domain search if you want a registrar answer and a price. This tool does not sell the domain.'));
    }

    private static function speed(array $input)
    {
        return self::ok('Use the browser measurement', array(), array('Latency, download and upload are measured by the page against this service. This endpoint does not invent a speed.'));
    }

    private static function fetch($url, $redirects, $body = false)
    {
        $current = $url;
        $guard = 0;
        while ($guard <= $redirects) {
            $parsed = Guard::publicUrl($current);
            if ($parsed === null) {
                return array('ok' => false, 'error' => 'Redirect target is not allowed.');
            }
            $ips = Guard::resolvePublic($parsed['host']);
            if (!$ips) {
                return array('ok' => false, 'error' => 'Host is not a public address.');
            }
            $response = self::curlFull($parsed['url'], $ips[0], $body);
            if (!$response['ok'] && $response['status'] === 0) {
                return $response;
            }
            if ($response['status'] >= 300 && $response['status'] < 400 && !empty($response['location']) && $guard < $redirects) {
                $current = self::absoluteUrl($parsed['url'], $response['location']);
                $guard++;
                continue;
            }
            $response['url'] = $parsed['url'];
            return $response;
        }
        return array('ok' => false, 'error' => 'Too many redirects.');
    }

    private static function curlFull($url, $pin, $wantBody)
    {
        if (!function_exists('curl_init')) {
            $plain = Net::request($url, array(), 8, null);
            $plain['headers'] = array();
            $plain['location'] = '';
            return $plain;
        }
        $handle = curl_init($url);
        $parts = parse_url($url);
        $port = isset($parts['port']) ? (int) $parts['port'] : ($parts['scheme'] === 'http' ? 80 : 443);
        curl_setopt_array($handle, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_NOBODY => !$wantBody,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'CloudHost247-Tools/1.0',
            CURLOPT_RESOLVE => array($parts['host'] . ':' . $port . ':' . $pin),
        ));
        $raw = curl_exec($handle);
        $error = curl_error($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $headerSize = (int) curl_getinfo($handle, CURLINFO_HEADER_SIZE);
        curl_close($handle);
        if ($raw === false) {
            return array('ok' => false, 'error' => $error !== '' ? $error : 'request failed', 'status' => 0, 'headers' => array(), 'body' => '', 'location' => '');
        }
        $headerText = substr($raw, 0, $headerSize);
        $bodyText = $wantBody ? substr($raw, $headerSize, 262144) : '';
        $headers = array();
        $location = '';
        foreach (preg_split("/\r\n|\n|\r/", $headerText) as $line) {
            if (strpos($line, ':') === false) {
                continue;
            }
            list($name, $value) = explode(':', $line, 2);
            $headers[] = array(trim($name), trim($value));
            if (strtolower(trim($name)) === 'location') {
                $location = trim($value);
            }
        }
        return array('ok' => $status >= 200 && $status < 400, 'status' => $status, 'headers' => $headers, 'body' => $bodyText, 'location' => $location, 'error' => $status >= 400 ? 'HTTP ' . $status : '');
    }

    private static function rdap($path)
    {
        $base = 'https://rdap.org/';
        $data = Catalog::data();
        if (!empty($data['providers']['rdap']) && is_string($data['providers']['rdap']) && strpos($data['providers']['rdap'], 'https://') === 0) {
            $base = rtrim($data['providers']['rdap'], '/') . '/';
        }
        $url = $base . ltrim($path, '/');
        $response = Net::request($url, array('Accept: application/rdap+json, application/json'), 10, null);
        if (!$response['ok']) {
            return array('ok' => false, 'error' => $response['error'] !== '' ? $response['error'] : 'RDAP returned HTTP ' . $response['status'], 'url' => $url);
        }
        $json = json_decode($response['body'], true);
        if (!is_array($json)) {
            return array('ok' => false, 'error' => 'RDAP payload was not JSON.', 'url' => $url);
        }
        return array('ok' => true, 'json' => $json, 'url' => $url);
    }

    private static function geo($ip)
    {
        $base = 'https://ipwho.is/';
        $data = Catalog::data();
        if (!empty($data['providers']['geo']) && is_string($data['providers']['geo']) && strpos($data['providers']['geo'], 'https://') === 0) {
            $base = rtrim($data['providers']['geo'], '/') . '/';
        }
        $response = Net::request($base . rawurlencode($ip), array('Accept: application/json'), 8, null);
        if (!$response['ok']) {
            return array('ok' => false, 'error' => $response['error'] !== '' ? $response['error'] : 'Geolocation provider unavailable');
        }
        $json = json_decode($response['body'], true);
        if (!is_array($json) || (isset($json['success']) && $json['success'] === false)) {
            return array('ok' => false, 'error' => 'Provider returned no estimate');
        }
        return array('ok' => true, 'json' => $json);
    }

    private static function rdapRows(array $json)
    {
        $rows = array();
        foreach (array('ldhName', 'handle', 'name', 'type', 'country', 'startAddress', 'endAddress', 'ipVersion') as $key) {
            if (isset($json[$key]) && !is_array($json[$key])) {
                $rows[] = array('Field' => $key, 'Value' => (string) $json[$key]);
            }
        }
        if (!empty($json['status']) && is_array($json['status'])) {
            $rows[] = array('Field' => 'status', 'Value' => implode(', ', $json['status']));
        }
        if (!$rows) {
            $rows[] = array('Field' => 'objectClassName', 'Value' => isset($json['objectClassName']) ? $json['objectClassName'] : 'RDAP object');
        }
        return $rows;
    }

    private static function reverseName($ip)
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return implode('.', array_reverse(explode('.', $ip))) . '.in-addr.arpa';
        }
        $packed = @inet_pton($ip);
        if ($packed === false) {
            return null;
        }
        $hex = unpack('H*hex', $packed);
        return implode('.', array_reverse(str_split($hex['hex']))) . '.ip6.arpa';
    }

    private static function absoluteUrl($base, $relative)
    {
        if (preg_match('#^https?://#i', $relative)) {
            return $relative;
        }
        $parts = parse_url($base);
        if (!$parts || empty($parts['host'])) {
            return null;
        }
        $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        if (isset($relative[0]) && $relative[0] === '/') {
            return $origin . $relative;
        }
        $path = isset($parts['path']) ? preg_replace('#/[^/]*$#', '/', $parts['path']) : '/';
        return $origin . $path . $relative;
    }

    private static function defaultLimit($handler)
    {
        $heavy = array('dns_checker', 'dns_propagation', 'dns_health', 'broken_links', 'link_analyzer', 'ip_blacklist', 'email_blacklist', 'ipv6_compat');
        return in_array($handler, $heavy, true) ? 8 : 30;
    }

    private static function ok($summary, array $rows, array $notes = array(), $elapsed = null)
    {
        $result = array('ok' => true, 'summary' => $summary, 'rows' => $rows, 'notes' => $notes, 'error' => null);
        if ($elapsed !== null) {
            $result['elapsedMs'] = $elapsed;
        }
        return $result;
    }

    private static function fail($message, $status = 400)
    {
        return array('ok' => false, 'summary' => '', 'rows' => array(), 'notes' => array(), 'error' => $message, 'status' => $status);
    }
}
