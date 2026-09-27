<?php
/**
 * Search Tools Module
 * Domain Name Search / Availability Checker
 */

class SearchTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * Domain Name Availability Search
     * Checks if a domain is available for registration
     */
    public function domainSearch($params) {
        $domain = $this->sanitizeDomain($params['domain'] ?? '');
        
        if (empty($domain)) {
            throw new Exception('Domain name is required');
        }
        
        // Validate domain format
        if (!$this->isValidDomain($domain)) {
            throw new Exception('Invalid domain name format');
        }
        
        $results = [];
        
        // Check if domain has TLD, if not check multiple TLDs
        if (strpos($domain, '.') === false) {
            $tlds = ['.com', '.net', '.org', '.io', '.co', '.info', '.biz', '.us', '.eu', '.me'];
            foreach ($tlds as $tld) {
                $results[] = $this->checkDomainAvailability($domain . $tld);
            }
        } else {
            $results[] = $this->checkDomainAvailability($domain);
        }
        
        return [
            'query' => $domain,
            'results' => $results,
            'timestamp' => date('Y-m-d H:i:s')
        ];
    }
    
    /**
     * Check domain availability via DNS lookup
     */
    private function checkDomainAvailability($domain) {
        // Check DNS records
        $records = @dns_get_record($domain, DNS_A + DNS_MX);
        $isAvailable = empty($records);
        
        // Also try gethostbyname as secondary check
        $ip = gethostbyname($domain);
        if ($ip !== $domain) {
            $isAvailable = false;
        }
        
        // Check WHOIS for more accurate status
        $whoisData = $this->getBasicWhois($domain);
        
        $parts = explode('.', $domain);
        $tld = '.' . end($parts);
        $sld = implode('.', array_slice($parts, 0, -1));
        
        return [
            'domain' => $domain,
            'sld' => $sld,
            'tld' => $tld,
            'available' => $isAvailable && stripos($whoisData, 'No match') !== false,
            'status' => $isAvailable ? 'AVAILABLE' : 'TAKEN',
            'has_dns' => !empty($records),
            'nameservers' => $this->getNameservers($domain),
            'whois_info' => $whoisData ? substr($whoisData, 0, 500) : null
        ];
    }
    
    /**
     * Basic WHOIS lookup
     */
    private function getBasicWhois($domain) {
        $whoisServers = [
            'com' => 'whois.verisign-grs.com',
            'net' => 'whois.verisign-grs.com',
            'org' => 'whois.pir.org',
            'io' => 'whois.nic.io',
            'co' => 'whois.nic.co',
            'info' => 'whois.afilias.net',
            'biz' => 'whois.biz',
            'us' => 'whois.nic.us',
            'eu' => 'whois.eu',
            'me' => 'whois.nic.me',
        ];
        
        $parts = explode('.', $domain);
        $tld = strtolower(end($parts));
        
        if (!isset($whoisServers[$tld])) {
            return null;
        }
        
        $socket = @fsockopen($whoisServers[$tld], 43, $errno, $errstr, 5);
        if (!$socket) {
            return null;
        }
        
        fputs($socket, $domain . "\r\n");
        $result = '';
        while (!feof($socket)) {
            $result .= fgets($socket, 128);
        }
        fclose($socket);
        
        return $result;
    }
    
    /**
     * Get nameservers for domain
     */
    private function getNameservers($domain) {
        $nsRecords = @dns_get_record($domain, DNS_NS);
        $nameservers = [];
        if ($nsRecords) {
            foreach ($nsRecords as $record) {
                if (isset($record['target'])) {
                    $nameservers[] = $record['target'];
                }
            }
        }
        return $nameservers;
    }
    
    /**
     * Sanitize domain input
     */
    private function sanitizeDomain($domain) {
        $domain = strtolower(trim($domain));
        $domain = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $domain);
        $domain = preg_replace('/[^a-z0-9.\-]/', '', $domain);
        return substr($domain, 0, 253);
    }
    
    /**
     * Validate domain format
     */
    private function isValidDomain($domain) {
        return (bool) preg_match($this->config['allowed_domains_regex'], $domain);
    }
}