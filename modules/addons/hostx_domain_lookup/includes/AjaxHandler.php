<?php
/**
 * HostX Tools - AJAX Handler
 *
 * Handles all AJAX requests from the client area.
 * Processes tool requests with CSRF validation and rate limiting.
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

class AjaxHandler
{
    /**
     * @var SecurityManager
     */
    private $security;
    
    /**
     * @var WhoisTool
     */
    private $whoisTool;
    
    /**
     * @var IpTool
     */
    private $ipTool;
    
    /**
     * @var DnsTool
     */
    private $dnsTool;
    
    /**
     * @var DomainAvailability
     */
    private $availabilityTool;
    
    /**
     * @var bool Debug mode
     */
    private $debug;
    
    /**
     * Constructor
     */
    public function __construct()
    {
        $this->security = new SecurityManager();
        $this->whoisTool = new WhoisTool();
        $this->ipTool = new IpTool();
        $this->dnsTool = new DnsTool();
        $this->availabilityTool = new DomainAvailability();
        
        $config = $this->getModuleConfig();
        $this->debug = !empty($config['debug_mode']) && $config['debug_mode'] === 'on';
    }
    
    /**
     * Handle incoming request
     *
     * @return string JSON response
     */
    public function handle()
    {
        try {
            // Validate request method
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                return $this->errorResponse('Invalid request method. POST required.');
            }
            
            // Validate CSRF token
            $csrfToken = $_POST['csrf_token'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
            if (!SecurityManager::validateCsrfToken($csrfToken)) {
                return $this->errorResponse('Invalid security token. Please refresh the page and try again.');
            }
            
            // Get action
            $action = $_POST['action'] ?? '';
            
            if (empty($action)) {
                return $this->errorResponse('No action specified.');
            }
            
            // Route to appropriate handler
            switch ($action) {
                case 'domain_whois':
                    return $this->handleDomainWhois();
                    
                case 'ip_whois':
                    return $this->handleIpWhois();
                    
                case 'dns_lookup':
                    return $this->handleDnsLookup();
                    
                case 'domain_availability':
                    return $this->handleDomainAvailability();
                    
                default:
                    return $this->errorResponse('Unknown action: ' . SecurityManager::escapeHtml($action));
            }
            
        } catch (Exception $e) {
            if ($this->debug) {
                return $this->errorResponse('Server error: ' . $e->getMessage());
            }
            
            return $this->errorResponse('An unexpected error occurred. Please try again later.');
        }
    }
    
    /**
     * Handle domain WHOIS request
     *
     * @return string JSON response
     */
    private function handleDomainWhois()
    {
        // Check rate limit
        if (!$this->security->checkRateLimit('domain_whois')) {
            return $this->errorResponse('Rate limit exceeded. Please wait a moment before trying again.');
        }
        
        $domain = $_POST['domain'] ?? '';
        
        if (empty($domain)) {
            return $this->errorResponse('Please enter a domain name.');
        }
        
        $result = $this->whoisTool->lookup($domain);
        
        if (!$result['success']) {
            return $this->errorResponse($result['error'] ?? 'WHOIS lookup failed', $result);
        }
        
        return $this->successResponse($result);
    }
    
    /**
     * Handle IP WHOIS request
     *
     * @return string JSON response
     */
    private function handleIpWhois()
    {
        // Check rate limit
        if (!$this->security->checkRateLimit('ip_whois')) {
            return $this->errorResponse('Rate limit exceeded. Please wait a moment before trying again.');
        }
        
        $ip = $_POST['ip'] ?? '';
        
        if (empty($ip)) {
            return $this->errorResponse('Please enter an IP address.');
        }
        
        $result = $this->ipTool->lookup($ip);
        
        if (!$result['success']) {
            return $this->errorResponse($result['error'] ?? 'IP lookup failed', $result);
        }
        
        return $this->successResponse($result);
    }
    
    /**
     * Handle DNS lookup request
     *
     * @return string JSON response
     */
    private function handleDnsLookup()
    {
        // Check rate limit
        if (!$this->security->checkRateLimit('dns_lookup')) {
            return $this->errorResponse('Rate limit exceeded. Please wait a moment before trying again.');
        }
        
        $domain = $_POST['domain'] ?? '';
        $type = $_POST['type'] ?? 'ALL';
        
        if (empty($domain)) {
            return $this->errorResponse('Please enter a domain name.');
        }
        
        $result = $this->dnsTool->lookup($domain, $type);
        
        if (!$result['success']) {
            return $this->errorResponse($result['error'] ?? 'DNS lookup failed', $result);
        }
        
        return $this->successResponse($result);
    }
    
    /**
     * Handle domain availability request
     *
     * @return string JSON response
     */
    private function handleDomainAvailability()
    {
        // Check rate limit
        if (!$this->security->checkRateLimit('availability')) {
            return $this->errorResponse('Rate limit exceeded. Please wait a moment before trying again.');
        }
        
        $domain = $_POST['domain'] ?? '';
        $tlds = isset($_POST['tlds']) ? (array)$_POST['tlds'] : [];
        
        if (empty($domain)) {
            return $this->errorResponse('Please enter a domain name.');
        }
        
        // Limit TLDs
        if (count($tlds) > 10) {
            $tlds = array_slice($tlds, 0, 10);
        }
        
        $result = $this->availabilityTool->check($domain, $tlds);
        
        if (!$result['success']) {
            return $this->errorResponse($result['error'] ?? 'Availability check failed', $result);
        }
        
        return $this->successResponse($result);
    }
    
    /**
     * Return success response
     *
     * @param array $data
     * @return string
     */
    private function successResponse($data)
    {
        $response = [
            'success' => true,
            'data'    => $data,
        ];
        
        if ($this->debug) {
            $response['debug'] = [
                'memory_usage' => memory_get_usage(true),
                'peak_memory'  => memory_get_peak_usage(true),
                'execution_time' => microtime(true) - ($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true)),
            ];
        }
        
        return json_encode($response);
    }
    
    /**
     * Return error response
     *
     * @param string $message
     * @param array $extra
     * @return string
     */
    private function errorResponse($message, $extra = [])
    {
        $response = [
            'success' => false,
            'error'   => $message,
        ];
        
        if (!empty($extra)) {
            $response['details'] = $extra;
        }
        
        if ($this->debug) {
            $response['debug'] = [
                'memory_usage' => memory_get_usage(true),
                'peak_memory'  => memory_get_peak_usage(true),
            ];
        }
        
        return json_encode($response);
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
            $result = \Capsule::table('tbladdonmodules')
                ->where('module', 'hostx_domain_lookup')
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
