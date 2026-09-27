<?php
/**
 * CloudHost247 Domain Lookup - DNS Tool
 *
 * Handles DNS lookups using native PHP dns_get_record().
 * No external API needed - uses PHP's built-in DNS functions.
 *
 * @package    WHMCS
 * @author     CloudHost247
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 */

namespace WHMCS\Module\Addon\CloudHost247DomainLookup;

use Exception;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

class DnsTool
{
    /**
     * @var CacheManager
     */
    private $cache;
    
    /**
     * @var array DNS record type constants
     */
    private $recordTypes = [
        'A'     => DNS_A,
        'AAAA'  => DNS_AAAA,
        'MX'    => DNS_MX,
        'NS'    => DNS_NS,
        'TXT'   => DNS_TXT,
        'CNAME' => DNS_CNAME,
        'SOA'   => DNS_SOA,
        'PTR'   => DNS_PTR,
        'SRV'   => DNS_SRV,
        'CAA'   => DNS_CAA,
    ];
    
    /**
     * Constructor
     */
    public function __construct()
    {
        $this->cache = new CacheManager();
    }
    
    /**
     * Perform DNS lookup
     *
     * @param string $domain
     * @param string $type DNS record type (A, AAAA, MX, NS, TXT, CNAME, SOA, PTR, SRV, CAA, ALL)
     * @return array
     */
    public function lookup($domain, $type = 'ALL')
    {
        // Sanitize input
        $domain = SecurityManager::sanitizeDomain($domain);
        
        if ($domain === false) {
            return [
                'success' => false,
                'error'   => 'Invalid domain name provided',
                'source'  => 'validation',
            ];
        }
        
        $type = SecurityManager::sanitizeDnsType($type);
        
        // Check cache
        $cacheKey = 'dns_' . md5($domain . '_' . $type);
        $cached = $this->cache->get($cacheKey);
        
        if ($cached !== false) {
            $cached['cached'] = true;
            $cached['cache_time'] = date('Y-m-d H:i:s');
            return $cached;
        }
        
        try {
            $records = [];
            
            if ($type === 'ALL') {
                // Query all supported record types
                foreach ($this->recordTypes as $recordType => $constant) {
                    $typeRecords = $this->queryDns($domain, $recordType);
                    if (!empty($typeRecords)) {
                        $records = array_merge($records, $typeRecords);
                    }
                }
            } else {
                // Query specific record type
                $records = $this->queryDns($domain, $type);
            }
            
            if (empty($records)) {
                $result = [
                    'success'  => true,
                    'domain'   => $domain,
                    'type'     => $type,
                    'records'  => [],
                    'count'    => 0,
                    'source'   => 'php_dns',
                    'cached'   => false,
                ];
                
                $this->cache->set($cacheKey, $result);
                $this->logRequest($domain, 'php_dns', 'success');
                
                return $result;
            }
            
            // Sort records by type
            usort($records, function ($a, $b) {
                $order = ['SOA' => 1, 'NS' => 2, 'A' => 3, 'AAAA' => 4, 'MX' => 5, 'CNAME' => 6, 'TXT' => 7, 'SRV' => 8, 'CAA' => 9, 'PTR' => 10];
                $aOrder = $order[$a['type']] ?? 99;
                $bOrder = $order[$b['type']] ?? 99;
                return $aOrder <=> $bOrder;
            });
            
            $result = [
                'success'  => true,
                'domain'   => $domain,
                'type'     => $type,
                'records'  => $records,
                'count'    => count($records),
                'source'   => 'php_dns',
                'cached'   => false,
            ];
            
            $this->cache->set($cacheKey, $result);
            $this->logRequest($domain, 'php_dns', 'success');
            
            return $result;
            
        } catch (Exception $e) {
            $this->logRequest($domain, 'php_dns', 'error', $e->getMessage());
            
            return [
                'success' => false,
                'error'   => 'DNS lookup failed: ' . $e->getMessage(),
                'domain'  => $domain,
                'source'  => 'php_dns',
            ];
        }
    }
    
    /**
     * Query DNS records
     *
     * @param string $domain
     * @param string $type
     * @return array
     */
    private function queryDns($domain, $type)
    {
        $records = [];
        
        if (!isset($this->recordTypes[$type])) {
            return $records;
        }
        
        $dnsType = $this->recordTypes[$type];
        
        // Suppress warnings for domains that don't have certain record types
        $dnsRecords = @dns_get_record($domain, $dnsType);
        
        if ($dnsRecords === false || empty($dnsRecords)) {
            return $records;
        }
        
        foreach ($dnsRecords as $record) {
            $parsed = $this->parseRecord($record, $type);
            if ($parsed !== null) {
                $records[] = $parsed;
            }
        }
        
        return $records;
    }
    
    /**
     * Parse a DNS record into normalized format
     *
     * @param array $record
     * @param string $type
     * @return array|null
     */
    private function parseRecord($record, $type)
    {
        if (!isset($record['host'])) {
            return null;
        }
        
        $base = [
            'type'     => $type,
            'host'     => $record['host'],
            'class'    => $record['class'] ?? 'IN',
            'ttl'      => $record['ttl'] ?? 0,
        ];
        
        switch ($type) {
            case 'A':
                $base['ip'] = $record['ip'] ?? null;
                return $base;
                
            case 'AAAA':
                $base['ipv6'] = $record['ipv6'] ?? null;
                return $base;
                
            case 'MX':
                $base['target'] = $record['target'] ?? null;
                $base['pri'] = $record['pri'] ?? 0;
                return $base;
                
            case 'NS':
                $base['target'] = $record['target'] ?? null;
                return $base;
                
            case 'TXT':
                $base['txt'] = $record['txt'] ?? null;
                // Handle multiple txt entries
                if (isset($record['entries']) && is_array($record['entries'])) {
                    $base['txt'] = implode('', $record['entries']);
                }
                return $base;
                
            case 'CNAME':
                $base['target'] = $record['target'] ?? null;
                return $base;
                
            case 'SOA':
                $base['mname'] = $record['mname'] ?? null;
                $base['rname'] = $record['rname'] ?? null;
                $base['serial'] = $record['serial'] ?? null;
                $base['refresh'] = $record['refresh'] ?? null;
                $base['retry'] = $record['retry'] ?? null;
                $base['expire'] = $record['expire'] ?? null;
                $base['minimum-ttl'] = $record['minimum-ttl'] ?? null;
                return $base;
                
            case 'PTR':
                $base['target'] = $record['target'] ?? null;
                return $base;
                
            case 'SRV':
                $base['target'] = $record['target'] ?? null;
                $base['pri'] = $record['pri'] ?? 0;
                $base['weight'] = $record['weight'] ?? 0;
                $base['port'] = $record['port'] ?? 0;
                return $base;
                
            case 'CAA':
                $base['flags'] = $record['flags'] ?? 0;
                $base['tag'] = $record['tag'] ?? null;
                $base['value'] = $record['value'] ?? null;
                return $base;
                
            default:
                return null;
        }
    }
    
    /**
     * Log the request
     *
     * @param string $query
     * @param string $source
     * @param string $status
     * @param string $message
     */
    private function logRequest($query, $source, $status, $message = '')
    {
        if (function_exists('cloudhost247_domain_lookup_log')) {
            cloudhost247_domain_lookup_log('dns_lookup', $query, $source, $status, $message);
        }
    }
}
