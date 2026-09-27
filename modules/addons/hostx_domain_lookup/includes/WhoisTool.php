<?php
/**
 * HostX Tools - WHOIS Tool
 *
 * Handles domain WHOIS lookups with API priority and native fallback.
 *
 * @package    WHMCS
 * @author     HostX Tools Team
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 */

namespace WHMCS\Module\Addon\HostXTools;

use Exception;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

class WhoisTool
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
     * Constructor
     */
    public function __construct()
    {
        $this->cache = new CacheManager();
        $this->whatismyip = new WhatIsMyIPApi();
        $this->nativeWhois = new NativeWhois();
    }
    
    /**
     * Perform domain WHOIS lookup
     *
     * Priority: WhatIsMyIP API → Native PHP WHOIS (port 43)
     *
     * @param string $domain
     * @return array
     */
    public function lookup($domain)
    {
        // Sanitize input
        $domain = SecurityManager::sanitizeDomain($domain);
        
        if ($domain === false) {
            return [
                'success' => false,
                'error'   => 'Invalid domain name provided',
                'domain'  => $domain,
                'source'  => 'validation',
            ];
        }
        
        // Check cache
        $cacheKey = 'whois_' . md5($domain);
        $cached = $this->cache->get($cacheKey);
        
        if ($cached !== false) {
            $cached['cached'] = true;
            $cached['cache_time'] = date('Y-m-d H:i:s');
            return $cached;
        }
        
        // Try primary API (WhatIsMyIP)
        $result = $this->whatismyip->domainWhois($domain);
        
        if ($result['success']) {
            $result['cached'] = false;
            $this->cache->set($cacheKey, $result);
            $this->logRequest($domain, 'whatismyip', 'success');
            return $result;
        }
        
        // Log API failure
        $this->logRequest($domain, 'whatismyip', 'error', $result['error'] ?? 'Unknown error');
        
        // Fallback to native WHOIS
        $result = $this->nativeWhois->lookup($domain);
        
        if ($result['success']) {
            $result['cached'] = false;
            $result['fallback'] = true;
            $result['fallback_reason'] = 'Primary API unavailable';
            $this->cache->set($cacheKey, $result);
            $this->logRequest($domain, 'native_whois', 'success');
            return $result;
        }
        
        // Both failed
        $this->logRequest($domain, 'native_whois', 'error', $result['error'] ?? 'Unknown error');
        
        return [
            'success' => false,
            'error'   => 'Unable to retrieve WHOIS information. The domain may not be registered, or all lookup services are temporarily unavailable.',
            'domain'  => $domain,
            'source'  => 'all_failed',
            'api_error' => $result['error'] ?? 'Unknown error',
        ];
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
        if (function_exists('hostx_domain_lookup_log')) {
            hostx_domain_lookup_log('domain_whois', $query, $source, $status, $message);
        }
    }
}
