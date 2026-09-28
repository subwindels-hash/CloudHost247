<?php
/**
 * CloudHost247 Tools - Security Manager
 *
 * Handles CSRF protection, input sanitization, output escaping,
 * and rate limiting for all tools.
 *
 * @package    WHMCS
 * @author     CloudHost247 Tools Team
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 */

namespace WHMCS\Module\Addon\CloudHost247Tools;

use Capsule;
use Exception;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

class SecurityManager
{
    /**
     * @var int Rate limit window in seconds (1 minute)
     */
    private $window = 60;
    
    /**
     * @var int Maximum requests per window
     */
    private $maxRequests;
    
    /**
     * Constructor
     */
    public function __construct()
    {
        $config = $this->getModuleConfig();
        $this->maxRequests = isset($config['rate_limit_requests']) ? (int)$config['rate_limit_requests'] : 30;
    }
    
    /**
     * Generate CSRF token
     *
     * @return string
     */
    public static function generateCsrfToken()
    {
        if (empty($_SESSION['cloudhost247_domain_lookup_csrf'])) {
            $_SESSION['cloudhost247_domain_lookup_csrf'] = bin2hex(random_bytes(32));
        }
        
        return $_SESSION['cloudhost247_domain_lookup_csrf'];
    }
    
    /**
     * Validate CSRF token
     *
     * @param string $token
     * @return bool
     */
    public static function validateCsrfToken($token)
    {
        if (empty($token) || empty($_SESSION['cloudhost247_domain_lookup_csrf'])) {
            return false;
        }
        
        return hash_equals($_SESSION['cloudhost247_domain_lookup_csrf'], $token);
    }
    
    /**
     * Check rate limit for current user
     *
     * @param string $tool Tool identifier
     * @return bool True if request is allowed
     */
    public function checkRateLimit($tool)
    {
        // Rate limiting disabled
        if ($this->maxRequests <= 0) {
            return true;
        }
        
        $ipAddress = $this->getClientIp();
        $windowStart = time() - $this->window;
        
        try {
            // Clean old entries
            Capsule::table('cloudhost247_domain_lookup_rate_limit')
                ->where('window_start', '<', $windowStart)
                ->delete();
            
            // Get current count for this IP and tool
            $record = Capsule::table('cloudhost247_domain_lookup_rate_limit')
                ->where('ip_address', $ipAddress)
                ->where('tool', $tool)
                ->where('window_start', '>', $windowStart)
                ->first();
            
            if ($record) {
                if ($record->requests >= $this->maxRequests) {
                    return false;
                }
                
                // Increment request count
                Capsule::table('cloudhost247_domain_lookup_rate_limit')
                    ->where('id', $record->id)
                    ->update([
                        'requests' => $record->requests + 1,
                    ]);
                
                return true;
            }
            
            // Create new record
            Capsule::table('cloudhost247_domain_lookup_rate_limit')->insert([
                'ip_address'   => $ipAddress,
                'tool'         => $tool,
                'requests'     => 1,
                'window_start' => time(),
                'created_at'   => date('Y-m-d H:i:s'),
            ]);
            
            return true;
        } catch (Exception $e) {
            // If rate limiting fails, allow the request
            return true;
        }
    }
    
    /**
     * Get remaining requests for current user
     *
     * @param string $tool
     * @return int
     */
    public function getRemainingRequests($tool)
    {
        if ($this->maxRequests <= 0) {
            return -1; // Unlimited
        }
        
        $ipAddress = $this->getClientIp();
        $windowStart = time() - $this->window;
        
        try {
            $record = Capsule::table('cloudhost247_domain_lookup_rate_limit')
                ->where('ip_address', $ipAddress)
                ->where('tool', $tool)
                ->where('window_start', '>', $windowStart)
                ->first();
            
            if ($record) {
                $remaining = $this->maxRequests - $record->requests;
                return max(0, $remaining);
            }
            
            return $this->maxRequests;
        } catch (Exception $e) {
            return $this->maxRequests;
        }
    }
    
    /**
     * Sanitize domain input
     *
     * @param string $domain
     * @return string|false Returns sanitized domain or false if invalid
     */
    public static function sanitizeDomain($domain)
    {
        if (empty($domain)) {
            return false;
        }
        
        // Remove whitespace and convert to lowercase
        $domain = strtolower(trim($domain));
        
        // Remove protocol if present
        $domain = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $domain);
        
        // Remove path, query string, etc.
        $domain = parse_url('http://' . $domain, PHP_URL_HOST) ?: $domain;
        
        // Remove any remaining invalid characters
        $domain = preg_replace('/[^a-z0-9\.\-]/', '', $domain);
        
        // Validate domain format
        if (!preg_match('/^([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9\-]{0,61}[a-z0-9]$/i', $domain)) {
            // Allow IDN (internationalized domain names)
            if (!preg_match('/^([a-z0-9\x{00a1}-\x{ffff}]([a-z0-9\x{00a1}-\x{ffff}\-]{0,61}[a-z0-9\x{00a1}-\x{ffff}])?\.)+[a-z0-9\x{00a1}-\x{ffff}][a-z0-9\x{00a1}-\x{ffff}\-]{0,61}[a-z0-9\x{00a1}-\x{ffff}]$/iu', $domain)) {
                return false;
            }
        }
        
        // Check length
        if (strlen($domain) > 253) {
            return false;
        }
        
        return $domain;
    }
    
    /**
     * Sanitize IP address input
     *
     * @param string $ip
     * @return string|false Returns sanitized IP or false if invalid
     */
    public static function sanitizeIp($ip)
    {
        if (empty($ip)) {
            return false;
        }
        
        $ip = trim($ip);
        
        // Validate IPv4
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return $ip;
        }
        
        // Validate IPv6
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            return $ip;
        }
        
        // Check for "me" or empty to use client's IP
        if ($ip === 'me' || $ip === 'myip' || $ip === 'my') {
            return self::getClientIp();
        }
        
        return false;
    }
    
    /**
     * Sanitize DNS record type
     *
     * @param string $type
     * @return string
     */
    public static function sanitizeDnsType($type)
    {
        $validTypes = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'PTR', 'SRV', 'CAA', 'ALL'];
        
        $type = strtoupper(trim($type));
        
        if (in_array($type, $validTypes, true)) {
            return $type;
        }
        
        return 'ALL';
    }
    
    /**
     * Escape output for HTML
     *
     * @param string $text
     * @return string
     */
    public static function escapeHtml($text)
    {
        return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
    }
    
    /**
     * Get client IP address
     *
     * @return string
     */
    public static function getClientIp()
    {
        $headers = [
            'HTTP_CF_CONNECTING_IP',
            'HTTP_CLIENT_IP',
            'HTTP_X_FORWARDED_FOR',
            'HTTP_X_FORWARDED',
            'HTTP_X_CLUSTER_CLIENT_IP',
            'HTTP_FORWARDED_FOR',
            'HTTP_FORWARDED',
            'REMOTE_ADDR',
        ];
        
        foreach ($headers as $header) {
            if (!empty($_SERVER[$header])) {
                $ips = explode(',', $_SERVER[$header]);
                $ip = trim($ips[0]);
                
                if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                    return $ip;
                }
                
                if (filter_var($ip, FILTER_VALIDATE_IP)) {
                    return $ip;
                }
            }
        }
        
        return '127.0.0.1';
    }
    
    /**
     * Get module configuration
     *
     * @return array
     */
    private function getModuleConfig()
    {
        $settings = [];
        
        try {
            $result = Capsule::table('tbladdonmodules')
                ->where('module', 'cloudhost247_domain_lookup')
                ->get();
            
            foreach ($result as $row) {
                $settings[$row->setting] = $row->value;
            }
        } catch (Exception $e) {
            // Use defaults
        }
        
        return $settings;
    }
}
