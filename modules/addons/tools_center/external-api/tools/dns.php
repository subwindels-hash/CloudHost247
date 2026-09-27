<?php
/**
 * DNS Tools Module
 * SPF, DKIM, DMARC, DNS validation, lookups, and generators
 */

class DnsTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * SPF Record Checker
     */
    public function spfChecker($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $txtRecords = $this->getTXTRecords($domain);
        $spfRecords = [];
        $spfAnalysis = [];
        
        foreach ($txtRecords as $record) {
            if (stripos($record['txt'], 'v=spf1') !== false) {
                $spfRecords[] = $record['txt'];
                $spfAnalysis = $this->analyzeSPF($record['txt']);
            }
        }
        
        return [
            'domain' => $domain,
            'spf_found' => !empty($spfRecords),
            'spf_records' => $spfRecords,
            'analysis' => $spfAnalysis,
            'recommendations' => $this->getSPFRecommendations($spfRecords, $spfAnalysis)
        ];
    }
    
    /**
     * Analyze SPF record
     */
    private function analyzeSPF($spf) {
        $parts = preg_split('/\s+/', $spf);
        $mechanisms = [];
        $modifiers = [];
        $qualifier = '+';
        
        foreach ($parts as $part) {
            if (strpos($part, '=') !== false) {
                list($key, $value) = explode('=', $part, 2);
                $modifiers[$key] = $value;
            } elseif (preg_match('/^([+\-~\?]?)(all|include|a|mx|ptr|ip4|ip6|exists)$/i', $part, $matches)) {
                $mechanisms[] = [
                    'qualifier' => $matches[1] ?: '+',
                    'mechanism' => $matches[2],
                    'value' => str_replace($matches[1] . $matches[2], '', $part) ?: null
                ];
            }
        }
        
        $hasAll = false;
        foreach ($mechanisms as $m) {
            if (strtolower($m['mechanism']) === 'all') {
                $hasAll = true;
                $qualifier = $m['qualifier'];
            }
        }
        
        return [
            'mechanisms' => $mechanisms,
            'modifiers' => $modifiers,
            'has_all_mechanism' => $hasAll,
            'default_qualifier' => $qualifier,
            'too_many_dns_lookups' => count($mechanisms) > 10,
            'warnings' => $this->getSPFWarnings($mechanisms, $hasAll)
        ];
    }
    
    /**
     * Get SPF warnings
     */
    private function getSPFWarnings($mechanisms, $hasAll) {
        $warnings = [];
        
        if (!$hasAll) {
            $warnings[] = 'Missing "all" mechanism - SPF policy is not explicitly defined';
        }
        
        if (count($mechanisms) > 10) {
            $warnings[] = 'Too many DNS lookups (>10) - may cause evaluation failures';
        }
        
        return $warnings;
    }
    
    /**
     * Get SPF recommendations
     */
    private function getSPFRecommendations($records, $analysis) {
        $recs = [];
        
        if (empty($records)) {
            $recs[] = 'No SPF record found. Consider adding: v=spf1 mx a -all';
        }
        
        if (count($records) > 1) {
            $recs[] = 'Multiple SPF records found - only one is allowed. Merge them into a single record.';
        }
        
        if ($analysis['too_many_dns_lookups'] ?? false) {
            $recs[] = 'Reduce DNS lookups by using IP addresses instead of hostnames';
        }
        
        return $recs;
    }
    
    /**
     * Domain DNS Validation
     */
    public function dnsValidation($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $results = [
            'domain' => $domain,
            'checks' => []
        ];
        
        // DNSSEC
        $results['checks']['dnssec'] = $this->checkDNSSEC($domain);
        
        // Nameservers
        $results['checks']['nameservers'] = $this->checkNameservers($domain);
        
        // SOA record
        $results['checks']['soa'] = $this->checkSOA($domain);
        
        // MX records
        $results['checks']['mx'] = $this->checkMX($domain);
        
        // SPF
        $spf = $this->spfChecker(['domain' => $domain]);
        $results['checks']['spf'] = $spf['spf_found'] ? 'PASS' : 'FAIL';
        
        // Overall health
        $passed = 0;
        $total = count($results['checks']);
        foreach ($results['checks'] as $check => $status) {
            if (is_bool($status) && $status || $status === 'PASS') {
                $passed++;
            }
        }
        
        $results['health_score'] = round(($passed / $total) * 100);
        $results['status'] = $results['health_score'] >= 80 ? 'HEALTHY' : ($results['health_score'] >= 50 ? 'WARNING' : 'CRITICAL');
        
        return $results;
    }
    
    /**
     * Reverse IP Lookup
     */
    public function reverseIpLookup($params) {
        $ip = $this->sanitizeIP($params['ip'] ?? '');
        
        if (empty($ip)) {
            throw new Exception('IP address is required');
        }
        
        if (!$this->isValidIP($ip)) {
            throw new Exception('Invalid IP address');
        }
        
        $hostname = gethostbyaddr($ip);
        
        return [
            'ip' => $ip,
            'hostname' => $hostname !== $ip ? $hostname : null,
            'found' => $hostname !== $ip
        ];
    }
    
    /**
     * DNS Lookup (comprehensive)
     */
    public function dnsLookup($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        $type = strtoupper($params['type'] ?? 'ALL');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $validTypes = ['A', 'AAAA', 'MX', 'NS', 'SOA', 'TXT', 'CNAME', 'SRV', 'PTR', 'CAA', 'ALL'];
        
        if (!in_array($type, $validTypes)) {
            throw new Exception('Invalid DNS record type');
        }
        
        $results = [];
        
        if ($type === 'ALL' || $type === 'A') {
            $results['A'] = $this->getRecords($domain, DNS_A, 'ip');
        }
        if ($type === 'ALL' || $type === 'AAAA') {
            $results['AAAA'] = $this->getRecords($domain, DNS_AAAA, 'ipv6');
        }
        if ($type === 'ALL' || $type === 'MX') {
            $results['MX'] = $this->getRecords($domain, DNS_MX, 'target', 'pri');
        }
        if ($type === 'ALL' || $type === 'NS') {
            $results['NS'] = $this->getRecords($domain, DNS_NS, 'target');
        }
        if ($type === 'ALL' || $type === 'SOA') {
            $results['SOA'] = $this->getRecords($domain, DNS_SOA, 'rname');
        }
        if ($type === 'ALL' || $type === 'TXT') {
            $results['TXT'] = $this->getRecords($domain, DNS_TXT, 'txt');
        }
        if ($type === 'ALL' || $type === 'CNAME') {
            $results['CNAME'] = $this->getRecords($domain, DNS_CNAME, 'target');
        }
        if ($type === 'ALL' || $type === 'SRV') {
            $results['SRV'] = $this->getRecords($domain, DNS_SRV, 'target', 'pri', 'weight', 'port');
        }
        if ($type === 'ALL' || $type === 'CAA') {
            $results['CAA'] = $this->getRecords($domain, DNS_CAA, 'tag', 'value');
        }
        
        return [
            'domain' => $domain,
            'query_type' => $type,
            'records' => $results,
            'timestamp' => time()
        ];
    }
    
    /**
     * CNAME Lookup
     */
    public function cnameLookup($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $records = dns_get_record($domain, DNS_CNAME);
        $results = [];
        
        if ($records) {
            foreach ($records as $record) {
                $results[] = [
                    'name' => $record['host'],
                    'cname' => $record['target'],
                    'ttl' => $record['ttl'] ?? null
                ];
            }
        }
        
        // Check canonical resolution chain
        $chain = [];
        $current = $domain;
        $depth = 0;
        while ($depth < 10) {
            $cname = @dns_get_record($current, DNS_CNAME);
            if (!empty($cname) && isset($cname[0]['target'])) {
                $chain[] = ['from' => $current, 'to' => $cname[0]['target']];
                $current = $cname[0]['target'];
            } else {
                break;
            }
            $depth++;
        }
        
        return [
            'domain' => $domain,
            'records' => $results,
            'resolution_chain' => $chain,
            'final_target' => $current !== $domain ? $current : null,
            'chain_length' => count($chain)
        ];
    }
    
    /**
     * NS Lookup
     */
    public function nsLookup($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $records = @dns_get_record($domain, DNS_NS);
        $nameservers = [];
        
        if ($records) {
            foreach ($records as $record) {
                $ns = $record['target'];
                $nsIP = gethostbyname($ns);
                $nameservers[] = [
                    'name' => $ns,
                    'ip' => $nsIP !== $ns ? $nsIP : null,
                    'ipv6' => $this->getIPv6($ns),
                    'ttl' => $record['ttl'] ?? null
                ];
            }
        }
        
        return [
            'domain' => $domain,
            'nameservers' => $nameservers,
            'count' => count($nameservers),
            'glue_records' => array_filter($nameservers, function($ns) {
                return $ns['ip'] !== null;
            })
        ];
    }
    
    /**
     * MX Lookup
     */
    public function mxLookup($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $records = @dns_get_record($domain, DNS_MX);
        $mxRecords = [];
        
        if ($records) {
            // Sort by priority
            usort($records, function($a, $b) {
                return $a['pri'] - $b['pri'];
            });
            
            foreach ($records as $record) {
                $host = $record['target'];
                $ip = gethostbyname($host);
                $mxRecords[] = [
                    'host' => $host,
                    'priority' => $record['pri'],
                    'ip' => $ip !== $host ? $ip : null,
                    'ipv6' => $this->getIPv6($host),
                    'ttl' => $record['ttl'] ?? null
                ];
            }
        }
        
        return [
            'domain' => $domain,
            'mx_records' => $mxRecords,
            'count' => count($mxRecords),
            'has_mail_servers' => !empty($mxRecords)
        ];
    }
    
    /**
     * DNS Propagation Checker
     */
    public function dnsPropagation($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        $type = strtoupper($params['type'] ?? 'A');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $publicResolvers = [
            ['name' => 'Google', 'ip' => '8.8.8.8'],
            ['name' => 'Google Secondary', 'ip' => '8.8.4.4'],
            ['name' => 'Cloudflare', 'ip' => '1.1.1.1'],
            ['name' => 'Cloudflare Secondary', 'ip' => '1.0.0.1'],
            ['name' => 'OpenDNS', 'ip' => '208.67.222.222'],
            ['name' => 'OpenDNS Secondary', 'ip' => '208.67.220.220'],
            ['name' => 'Quad9', 'ip' => '9.9.9.9'],
            ['name' => 'Quad9 Secondary', 'ip' => '149.112.112.112'],
        ];
        
        $results = [];
        
        foreach ($publicResolvers as $resolver) {
            $result = $this->queryDNSViaResolver($domain, $type, $resolver['ip']);
            $results[] = [
                'resolver' => $resolver['name'],
                'resolver_ip' => $resolver['ip'],
                'status' => $result['status'],
                'records' => $result['records'] ?? null,
                'error' => $result['error'] ?? null
            ];
        }
        
        // Check consistency
        $allRecords = [];
        foreach ($results as $r) {
            if (isset($r['records'])) {
                $allRecords[] = json_encode($r['records']);
            }
        }
        
        $consistent = count(array_unique($allRecords)) <= 1;
        
        return [
            'domain' => $domain,
            'record_type' => $type,
            'results' => $results,
            'propagated' => $consistent,
            'propagation_status' => $consistent ? 'COMPLETE' : 'IN_PROGRESS'
        ];
    }
    
    /**
     * DMARC Validation Tool
     */
    public function dmarcValidation($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $txtRecords = $this->getTXTRecords($domain);
        $dmarcRecords = [];
        $warnings = [];
        
        foreach ($txtRecords as $record) {
            if (stripos($record['txt'], 'v=DMARC1') !== false) {
                $dmarcRecords[] = $record['txt'];
            }
        }
        
        // Also check _dmarc subdomain
        $dmarcDomain = '_dmarc.' . $domain;
        $dmarcTXT = $this->getTXTRecords($dmarcDomain);
        foreach ($dmarcTXT as $record) {
            if (stripos($record['txt'], 'v=DMARC1') !== false) {
                $dmarcRecords[] = $record['txt'];
            }
        }
        
        if (empty($dmarcRecords)) {
            $warnings[] = 'No DMARC record found. Add one to protect against email spoofing.';
        }
        
        $parsed = [];
        foreach ($dmarcRecords as $record) {
            $parsed[] = $this->parseDMARC($record);
        }
        
        return [
            'domain' => $domain,
            'dmarc_found' => !empty($dmarcRecords),
            'records' => $dmarcRecords,
            'parsed' => $parsed,
            'warnings' => $warnings,
            'recommendations' => $this->getDMARCRecommendations($dmarcRecords, $parsed)
        ];
    }
    
    /**
     * Parse DMARC record
     */
    private function parseDMARC($record) {
        $parts = preg_split('/\s*;\s*/', $record);
        $parsed = [];
        
        foreach ($parts as $part) {
            if (strpos($part, '=') !== false) {
                list($key, $value) = explode('=', $part, 2);
                $parsed[trim($key)] = trim($value);
            }
        }
        
        return [
            'raw' => $record,
            'version' => $parsed['v'] ?? null,
            'policy' => $parsed['p'] ?? null,
            'subdomain_policy' => $parsed['sp'] ?? null,
            'percentage' => $parsed['pct'] ?? 100,
            'rua' => $parsed['rua'] ?? null,
            'ruf' => $parsed['ruf'] ?? null,
            'adkim' => $parsed['adkim'] ?? 'r',
            'aspf' => $parsed['aspf'] ?? 'r',
            'fo' => $parsed['fo'] ?? '0',
            'rf' => $parsed['rf'] ?? 'afrf',
            'ri' => $parsed['ri'] ?? '86400',
            'parsed_values' => $parsed
        ];
    }
    
    /**
     * Get DMARC recommendations
     */
    private function getDMARCRecommendations($records, $parsed) {
        $recs = [];
        
        if (empty($records)) {
            $recs[] = 'Create DMARC record: v=DMARC1; p=none; rua=mailto:dmarc@' . $domain;
        }
        
        foreach ($parsed as $p) {
            if (empty($p['rua'])) {
                $recs[] = 'Add rua (aggregate report) address to receive DMARC reports';
            }
            if ($p['policy'] === 'none') {
                $recs[] = 'Consider upgrading policy to "quarantine" after monitoring period';
            }
            if (($p['percentage'] ?? 100) < 100) {
                $recs[] = 'Percentage is less than 100% - ensure this is intentional for testing';
            }
        }
        
        return $recs;
    }
    
    /**
     * Domain DNS Health Checker
     */
    public function dnsHealth($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $health = [
            'domain' => $domain,
            'overall_score' => 0,
            'checks' => [],
            'recommendations' => []
        ];
        
        $score = 0;
        $maxScore = 0;
        
        // DNSSEC check
        $maxScore += 15;
        $dnssec = $this->checkDNSSEC($domain);
        $health['checks']['dnssec'] = $dnssec ? 'PASS' : 'FAIL';
        if ($dnssec) $score += 15;
        
        // NS check
        $maxScore += 10;
        $ns = $this->nsLookup(['domain' => $domain]);
        $health['checks']['nameservers'] = $ns['count'] >= 2 ? 'PASS' : 'FAIL';
        if ($ns['count'] >= 2) $score += 10;
        else $health['recommendations'][] = 'Add at least 2 nameservers';
        
        // MX check
        $maxScore += 10;
        $mx = $this->mxLookup(['domain' => $domain]);
        $health['checks']['mx'] = $mx['has_mail_servers'] ? 'PASS' : 'INFO';
        if ($mx['has_mail_servers']) $score += 10;
        
        // SPF check
        $maxScore += 15;
        $spf = $this->spfChecker(['domain' => $domain]);
        $health['checks']['spf'] = $spf['spf_found'] ? 'PASS' : 'FAIL';
        if ($spf['spf_found']) $score += 15;
        else $health['recommendations'][] = 'Add SPF record to prevent email spoofing';
        
        // DMARC check
        $maxScore += 15;
        $dmarc = $this->dmarcValidation(['domain' => $domain]);
        $health['checks']['dmarc'] = $dmarc['dmarc_found'] ? 'PASS' : 'FAIL';
        if ($dmarc['dmarc_found']) $score += 15;
        else $health['recommendations'][] = 'Add DMARC record for email authentication';
        
        // DKIM check
        $maxScore += 15;
        $dkim = $this->dkimChecker(['domain' => $domain]);
        $health['checks']['dkim'] = $dkim['dkim_found'] ? 'PASS' : 'INFO';
        if ($dkim['dkim_found']) $score += 15;
        
        // CAA check
        $maxScore += 10;
        $caa = $this->getRecords($domain, DNS_CAA, 'tag');
        $health['checks']['caa'] = !empty($caa) ? 'PASS' : 'INFO';
        if (!empty($caa)) $score += 10;
        else $health['recommendations'][] = 'Consider adding CAA records to control certificate issuance';
        
        // SOA check
        $maxScore += 10;
        $soa = $this->checkSOA($domain);
        $health['checks']['soa'] = $soa ? 'PASS' : 'FAIL';
        if ($soa) $score += 10;
        
        $health['overall_score'] = round(($score / $maxScore) * 100);
        $health['status'] = $health['overall_score'] >= 90 ? 'EXCELLENT' : 
                           ($health['overall_score'] >= 70 ? 'GOOD' : 
                           ($health['overall_score'] >= 50 ? 'FAIR' : 'POOR'));
        
        return $health;
    }
    
    /**
     * DMARC Record Generator
     */
    public function dmarcGenerator($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? 'example.com');
        $policy = $params['policy'] ?? 'none';
        $subdomainPolicy = $params['subdomain_policy'] ?? '';
        $rua = $params['rua'] ?? 'dmarc-reports@' . $domain;
        $ruf = $params['ruf'] ?? '';
        $pct = $params['pct'] ?? '100';
        $aspf = $params['aspf'] ?? 'r';
        $adkim = $params['adkim'] ?? 'r';
        
        $validPolicies = ['none', 'quarantine', 'reject'];
        if (!in_array($policy, $validPolicies)) {
            throw new Exception('Invalid policy. Use: none, quarantine, reject');
        }
        
        $record = "v=DMARC1; p=$policy";
        
        if ($subdomainPolicy && in_array($subdomainPolicy, $validPolicies)) {
            $record .= "; sp=$subdomainPolicy";
        }
        
        if ($rua) {
            $record .= "; rua=mailto:$rua";
        }
        
        if ($ruf) {
            $record .= "; ruf=mailto:$ruf";
        }
        
        if ($pct && $pct != '100') {
            $record .= "; pct=$pct";
        }
        
        $record .= "; aspf=$aspf; adkim=$adkim";
        
        return [
            'domain' => $domain,
            'record_name' => '_dmarc.' . $domain,
            'record_type' => 'TXT',
            'record_value' => $record,
            'parsed' => $this->parseDMARC($record),
            'dns_entry' => "_dmarc.{$domain}.\tIN\tTXT\t\"{$record}\""
        ];
    }
    
    /**
     * DNSKEY Lookup
     */
    public function dnskeyLookup($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $records = @dns_get_record($domain, DNS_DNSKEY);
        $dnskeys = [];
        
        if ($records) {
            foreach ($records as $record) {
                $dnskeys[] = [
                    'flags' => $record['flags'] ?? null,
                    'protocol' => $record['protocol'] ?? null,
                    'algorithm' => $record['algorithm'] ?? null,
                    'key' => $record['key'] ?? null,
                    'public_key_base64' => isset($record['key']) ? base64_encode($record['key']) : null
                ];
            }
        }
        
        return [
            'domain' => $domain,
            'dnssec_enabled' => !empty($dnskeys),
            'dnskey_records' => $dnskeys,
            'count' => count($dnskeys)
        ];
    }
    
    /**
     * DS Lookup (Delegation Signer)
     */
    public function dsLookup($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        // DS records are typically at the parent zone
        // We can check if DNSSEC is active by looking for DNSKEY
        $dnskey = $this->dnskeyLookup(['domain' => $domain]);
        
        // Try to get DS records
        $records = @dns_get_record($domain, DNS_DS);
        $dsRecords = [];
        
        if ($records) {
            foreach ($records as $record) {
                $dsRecords[] = [
                    'key_tag' => $record['key_tag'] ?? null,
                    'algorithm' => $record['algorithm'] ?? null,
                    'digest_type' => $record['digest_type'] ?? null,
                    'digest' => $record['digest'] ?? null
                ];
            }
        }
        
        return [
            'domain' => $domain,
            'ds_found' => !empty($dsRecords),
            'ds_records' => $dsRecords,
            'dnssec_active' => $dnskey['dnssec_enabled'] ?? false,
            'recommendations' => empty($dsRecords) && ($dnskey['dnssec_enabled'] ?? false) 
                ? ['DS record should be added at parent zone registrar'] 
                : []
        ];
    }
    
    /**
     * DKIM Checker
     */
    public function dkimChecker($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        $selector = $params['selector'] ?? 'default';
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $commonSelectors = ['default', 'google', 'mail', 'dkim', 'selector1', 'selector2', 'k1', 'smtp'];
        if ($selector !== 'default') {
            $commonSelectors = array_merge([$selector], $commonSelectors);
        }
        
        $dkimRecords = [];
        
        foreach (array_unique($commonSelectors) as $sel) {
            $dkimDomain = $sel . '._domainkey.' . $domain;
            $records = $this->getTXTRecords($dkimDomain);
            
            foreach ($records as $record) {
                if (stripos($record['txt'], 'v=DKIM1') !== false) {
                    $dkimRecords[] = [
                        'selector' => $sel,
                        'domain' => $dkimDomain,
                        'record' => $record['txt'],
                        'parsed' => $this->parseDKIM($record['txt'])
                    ];
                }
            }
        }
        
        return [
            'domain' => $domain,
            'dkim_found' => !empty($dkimRecords),
            'selectors_tested' => array_unique(array_column($dkimRecords, 'selector')),
            'records' => $dkimRecords,
            'recommendations' => empty($dkimRecords) 
                ? ['No DKIM records found. Set up DKIM for email authentication.'] 
                : []
        ];
    }
    
    /**
     * Parse DKIM record
     */
    private function parseDKIM($record) {
        $parts = preg_split('/\s*;\s*/', $record);
        $parsed = [];
        
        foreach ($parts as $part) {
            if (strpos($part, '=') !== false) {
                list($key, $value) = explode('=', $part, 2);
                $parsed[trim($key)] = trim($value);
            }
        }
        
        return [
            'version' => $parsed['v'] ?? null,
            'key_type' => $parsed['k'] ?? 'rsa',
            'public_key' => $parsed['p'] ?? null,
            'notes' => $parsed['n'] ?? null,
            'service_type' => $parsed['s'] ?? '*',
            'hash_algorithms' => $parsed['h'] ?? null
        ];
    }
    
    // ==================== HELPER METHODS ====================
    
    private function getTXTRecords($domain) {
        $records = @dns_get_record($domain, DNS_TXT);
        $txtRecords = [];
        
        if ($records) {
            foreach ($records as $record) {
                $txtRecords[] = [
                    'host' => $record['host'],
                    'txt' => $record['txt'],
                    'ttl' => $record['ttl'] ?? null,
                    'class' => $record['class'] ?? 'IN'
                ];
            }
        }
        
        return $txtRecords;
    }
    
    private function getRecords($domain, $type, ...$fields) {
        $records = @dns_get_record($domain, $type);
        $results = [];
        
        if ($records) {
            foreach ($records as $record) {
                $item = [];
                foreach ($fields as $field) {
                    if (isset($record[$field])) {
                        $item[$field] = $record[$field];
                    }
                }
                if (!empty($item)) {
                    $results[] = $item;
                }
            }
        }
        
        return $results;
    }
    
    private function checkDNSSEC($domain) {
        $dnskey = @dns_get_record($domain, DNS_DNSKEY);
        return !empty($dnskey);
    }
    
    private function checkNameservers($domain) {
        $ns = @dns_get_record($domain, DNS_NS);
        return !empty($ns) && count($ns) >= 2;
    }
    
    private function checkSOA($domain) {
        $soa = @dns_get_record($domain, DNS_SOA);
        return !empty($soa);
    }
    
    private function checkMX($domain) {
        $mx = @dns_get_record($domain, DNS_MX);
        return !empty($mx);
    }
    
    private function getIPv6($host) {
        $records = @dns_get_record($host, DNS_AAAA);
        if (!empty($records) && isset($records[0]['ipv6'])) {
            return $records[0]['ipv6'];
        }
        return null;
    }
    
    private function queryDNSViaResolver($domain, $type, $resolverIP) {
        // Use dig command if available
        if (function_exists('exec')) {
            $type = escapeshellarg($type);
            $domain = escapeshellarg($domain);
            $resolver = escapeshellarg('@' . $resolverIP);
            
            $command = "dig +short {$type} {$domain} {$resolver} 2>/dev/null";
            $output = [];
            $returnCode = 0;
            exec($command, $output, $returnCode);
            
            if ($returnCode === 0 && !empty($output)) {
                return [
                    'status' => 'RESOLVED',
                    'records' => $output
                ];
            }
        }
        
        return [
            'status' => 'NO_ANSWER',
            'error' => 'Could not query resolver'
        ];
    }
    
    private function sanitizeDomain($domain) {
        $domain = strtolower(trim($domain));
        $domain = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $domain);
        $domain = preg_replace('/[^a-z0-9.\-]/', '', $domain);
        return substr($domain, 0, 253);
    }
    
    private function sanitizeIP($ip) {
        return filter_var(trim($ip), FILTER_VALIDATE_IP) ? trim($ip) : '';
    }
    
    private function isValidIP($ip) {
        return filter_var($ip, FILTER_VALIDATE_IP) !== false;
    }
}