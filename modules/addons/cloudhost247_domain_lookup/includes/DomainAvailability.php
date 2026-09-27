<?php
/**
 * CloudHost247 Domain Lookup - Domain Availability Checker
 *
 * Checks domain availability using API priority and native WHOIS fallback.
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

class DomainAvailability
{
    /**
     * @var CacheManager
     */
    private $cache;
    
    /**
     * @var WhatIsMyIPApi
     */
    private $whatismyip;
    
    /**
     * @var NativeWhois
     */
    private $nativeWhois;
    
    /**
     * @var array Popular TLDs to check
     */
    private $popularTlds = [
        'com', 'net', 'org', 'info', 'biz', 'us', 'io', 'co', 'me',
        'ca', 'uk', 'eu', 'de', 'fr', 'au', 'nl', 'in', 'es',
    ];
    
    /**
     * Constructor
     */
    public function __construct()
    {
        $this->cache = new CacheManager();
        $this->whatismyip = new WhatIsMyIPApi();
        $this->nativeWhois = new NativeWhois();
    }
    
    /**
     * Check domain availability
     *
     * @param string $domain Domain name (with or without TLD)
     * @param array $tlds Specific TLDs to check (optional)
     * @return array
     */
    public function check($domain, $tlds = [])
    {
        // Sanitize domain input (extract SLD)
        $domain = $this->sanitizeDomainInput($domain);
        
        if (empty($domain)) {
            return [
                'success' => false,
                'error'   => 'Invalid domain name provided',
                'source'  => 'validation',
            ];
        }
        
        // Determine which TLDs to check
        $checkTlds = !empty($tlds) ? $tlds : $this->popularTlds;
        
        // Limit to prevent abuse
        if (count($checkTlds) > 20) {
            $checkTlds = array_slice($checkTlds, 0, 20);
        }
        
        $results = [];
        $checkedCount = 0;
        
        foreach ($checkTlds as $tld) {
            $tld = ltrim(strtolower(trim($tld)), '.');
            $fullDomain = $domain . '.' . $tld;
            
            // Check cache
            $cacheKey = 'avail_' . md5($fullDomain);
            $cached = $this->cache->get($cacheKey);
            
            if ($cached !== false) {
                $results[] = $cached;
                continue;
            }
            
            // Perform check
            $result = $this->checkSingleDomain($fullDomain);
            
            if ($result['success']) {
                $this->cache->set($cacheKey, $result);
            }
            
            $results[] = $result;
            $checkedCount++;
            
            // Small delay to be respectful to WHOIS servers
            if ($checkedCount < count($checkTlds)) {
                usleep(200000); // 200ms
            }
        }
        
        return [
            'success'    => true,
            'domain'     => $domain,
            'tlds'       => $checkTlds,
            'results'    => $results,
            'total'      => count($results),
            'source'     => 'mixed',
            'cached'     => false,
        ];
    }
    
    /**
     * Check single domain availability
     *
     * @param string $fullDomain
     * @return array
     */
    private function checkSingleDomain($fullDomain)
    {
        // Try primary API (WhatIsMyIP)
        if ($this->whatismyip->isConfigured()) {
            $result = $this->whatismyip->checkAvailability($fullDomain);
            
            if ($result['success']) {
                $result['cached'] = false;
                $this->logRequest($fullDomain, 'whatismyip', 'success');
                return $result;
            }
            
            $this->logRequest($fullDomain, 'whatismyip', 'error', $result['error'] ?? 'Unknown');
        }
        
        // Fallback to native WHOIS
        $result = $this->nativeWhois->checkAvailability($fullDomain);
        
        if ($result['success']) {
            $result['cached'] = false;
            $result['fallback'] = true;
            $this->logRequest($fullDomain, 'native_whois', 'success');
            return $result;
        }
        
        // Both failed
        $this->logRequest($fullDomain, 'native_whois', 'error', $result['error'] ?? 'Unknown');
        
        return [
            'success'   => false,
            'domain'    => $fullDomain,
            'available' => null,
            'error'     => 'Unable to check availability',
            'source'    => 'all_failed',
        ];
    }
    
    /**
     * Get list of popular TLDs
     *
     * @return array
     */
    public function getPopularTlds()
    {
        return $this->popularTlds;
    }
    
    /**
     * Sanitize domain input - extract SLD
     *
     * @param string $domain
     * @return string|false
     */
    private function sanitizeDomainInput($domain)
    {
        if (empty($domain)) {
            return false;
        }
        
        $domain = strtolower(trim($domain));
        
        // Remove protocol
        $domain = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $domain);
        
        // Remove path
        $domain = parse_url('http://' . $domain, PHP_URL_HOST) ?: $domain;
        
        // Remove any dots at start/end
        $domain = trim($domain, '.');
        
        // If domain has TLD, extract just the SLD
        if (strpos($domain, '.') !== false) {
            $parts = explode('.', $domain);
            // Remove known TLDs to get the base name
            $tld = end($parts);
            if (in_array($tld, $this->popularTlds, true)) {
                array_pop($parts);
                $domain = implode('.', $parts);
            }
        }
        
        // Remove invalid characters
        $domain = preg_replace('/[^a-z0-9\-]/', '', $domain);
        
        // Validate length (1-63 characters per label)
        if (strlen($domain) < 1 || strlen($domain) > 63) {
            return false;
        }
        
        // Must start and end with letter or number
        if (!preg_match('/^[a-z0-9].*[a-z0-9]$/', $domain)) {
            return false;
        }
        
        return $domain;
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
            cloudhost247_domain_lookup_log('availability', $query, $source, $status, $message);
        }
    }
}
