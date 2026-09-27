<?php
/**
 * HostX Domain Lookup - IP Tool
 *
 * Handles IP lookups with API priority and fallback.
 *
 * @package    WHMCS
 * @author     HostX Tools Team
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 */

namespace WHMCS\Module\Addon\HostXDomainLookup;

use Exception;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

class IpTool
{
    /**
     * @var CacheManager
     */
    private $cache;
    
    /**
     * @var IPinfoApi
     */
    private $ipinfo;
    
    /**
     * @var IPWhoApi
     */
    private $ipwho;
    
    /**
     * Constructor
     */
    public function __construct()
    {
        $this->cache = new CacheManager();
        $this->ipinfo = new IPinfoApi();
        $this->ipwho = new IPWhoApi();
    }
    
    /**
     * Perform IP lookup
     *
     * Priority: IPinfo → IPWho (fallback)
     *
     * @param string $ip
     * @return array
     */
    public function lookup($ip)
    {
        // Sanitize input
        $ip = SecurityManager::sanitizeIp($ip);
        
        if ($ip === false) {
            return [
                'success' => false,
                'error'   => 'Invalid IP address provided. Please enter a valid IPv4 or IPv6 address.',
                'source'  => 'validation',
            ];
        }
        
        // Check cache
        $cacheKey = 'ip_' . md5($ip);
        $cached = $this->cache->get($cacheKey);
        
        if ($cached !== false) {
            $cached['cached'] = true;
            $cached['cache_time'] = date('Y-m-d H:i:s');
            return $cached;
        }
        
        // Try primary API (IPinfo)
        if ($this->ipinfo->isConfigured()) {
            $result = $this->ipinfo->lookupIp($ip);
            
            if ($result['success']) {
                $result['cached'] = false;
                $this->cache->set($cacheKey, $result);
                $this->logRequest($ip, 'ipinfo', 'success');
                return $result;
            }
            
            // Log API failure
            $this->logRequest($ip, 'ipinfo', 'error', $result['error'] ?? 'Unknown error');
        }
        
        // Fallback to IPWho
        $result = $this->ipwho->lookupIp($ip);
        
        if ($result['success']) {
            $result['cached'] = false;
            $result['fallback'] = true;
            $result['fallback_reason'] = 'IPinfo API unavailable or not configured';
            $this->cache->set($cacheKey, $result);
            $this->logRequest($ip, 'ipwho', 'success');
            return $result;
        }
        
        // Both failed
        $this->logRequest($ip, 'ipwho', 'error', $result['error'] ?? 'Unknown error');
        
        return [
            'success' => false,
            'error'   => 'Unable to retrieve IP information. All lookup services are temporarily unavailable.',
            'ip'      => $ip,
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
            hostx_domain_lookup_log('ip_whois', $query, $source, $status, $message);
        }
    }
}
