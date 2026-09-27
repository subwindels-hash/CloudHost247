<?php
/**
 * CloudHost247 Domain Lookup - WhatIsMyIP API Client
 *
 * Handles domain WHOIS lookups via WhatIsMyIP API.
 * Primary API for domain WHOIS queries.
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

class WhatIsMyIPApi
{
    /**
     * @var string API base URL
     */
    private $baseUrl = 'https://api.whatismyip.com/domain-tools.php';
    
    /**
     * @var string API key
     */
    private $apiKey;
    
    /**
     * @var int Request timeout in seconds
     */
    private $timeout;
    
    /**
     * Constructor
     */
    public function __construct()
    {
        $config = $this->getModuleConfig();
        $this->apiKey = !empty($config['whatismyip_api_key']) ? $config['whatismyip_api_key'] : '';
        $this->timeout = !empty($config['request_timeout']) ? (int)$config['request_timeout'] : 10;
    }
    
    /**
     * Check if API is configured
     *
     * @return bool
     */
    public function isConfigured()
    {
        return !empty($this->apiKey);
    }
    
    /**
     * Perform domain WHOIS lookup
     *
     * @param string $domain
     * @return array
     */
    public function domainWhois($domain)
    {
        if (!$this->isConfigured()) {
            return [
                'success' => false,
                'error'   => 'WhatIsMyIP API key not configured',
                'source'  => 'whatismyip',
            ];
        }
        
        try {
            $url = $this->baseUrl . '?key=' . urlencode($this->apiKey) 
                 . '&domain=' . urlencode($domain) 
                 . '&output=json';
            
            $response = $this->makeRequest($url);
            
            if ($response === false) {
                return [
                    'success' => false,
                    'error'   => 'Failed to connect to WhatIsMyIP API',
                    'source'  => 'whatismyip',
                ];
            }
            
            $data = json_decode($response, true);
            
            if (json_last_error() !== JSON_ERROR_NONE) {
                return [
                    'success' => false,
                    'error'   => 'Invalid JSON response from WhatIsMyIP API',
                    'source'  => 'whatismyip',
                ];
            }
            
            if (isset($data['error'])) {
                return [
                    'success' => false,
                    'error'   => $data['error'],
                    'source'  => 'whatismyip',
                ];
            }
            
            // Parse and normalize the response
            return $this->parseWhoisResponse($data, $domain);
            
        } catch (Exception $e) {
            return [
                'success' => false,
                'error'   => $e->getMessage(),
                'source'  => 'whatismyip',
            ];
        }
    }
    
    /**
     * Check domain availability
     *
     * @param string $domain
     * @return array
     */
    public function checkAvailability($domain)
    {
        if (!$this->isConfigured()) {
            return [
                'success' => false,
                'error'   => 'WhatIsMyIP API key not configured',
                'source'  => 'whatismyip',
            ];
        }
        
        try {
            $url = 'https://api.whatismyip.com/domain-check.php'
                 . '?key=' . urlencode($this->apiKey) 
                 . '&domain=' . urlencode($domain) 
                 . '&output=json';
            
            $response = $this->makeRequest($url);
            
            if ($response === false) {
                return [
                    'success' => false,
                    'error'   => 'Failed to connect to WhatIsMyIP API',
                    'source'  => 'whatismyip',
                ];
            }
            
            $data = json_decode($response, true);
            
            if (json_last_error() !== JSON_ERROR_NONE) {
                return [
                    'success' => false,
                    'error'   => 'Invalid JSON response',
                    'source'  => 'whatismyip',
                ];
            }
            
            return [
                'success'    => true,
                'domain'     => $domain,
                'available'  => isset($data['available']) ? (bool)$data['available'] : null,
                'registrar'  => $data['registrar'] ?? null,
                'source'     => 'whatismyip',
            ];
            
        } catch (Exception $e) {
            return [
                'success' => false,
                'error'   => $e->getMessage(),
                'source'  => 'whatismyip',
            ];
        }
    }
    
    /**
     * Parse WHOIS response into normalized format
     *
     * @param array $data
     * @param string $domain
     * @return array
     */
    private function parseWhoisResponse($data, $domain)
    {
        $result = [
            'success'       => true,
            'domain'        => $domain,
            'source'        => 'whatismyip',
        ];
        
        // Extract registrar
        $result['registrar'] = $this->extractField($data, [
            'registrar', 'Registrar', 'REGISTRAR',
            'registrar_name', 'RegistrarName', 'Sponsoring Registrar',
        ]);
        
        // Extract creation date
        $result['creation_date'] = $this->extractField($data, [
            'creation_date', 'Creation Date', 'created', 'Created On',
            'CreationDate', 'Domain Registration Date',
        ]);
        
        // Extract expiry date
        $result['expiry_date'] = $this->extractField($data, [
            'expiry_date', 'Expiry Date', 'Expiration Date', 'expires',
            'Registrar Registration Expiration Date', 'Registry Expiry Date',
        ]);
        
        // Extract name servers
        $result['name_servers'] = $this->extractNameServers($data);
        
        // Extract status
        $result['status'] = $this->extractStatus($data);
        
        // Extract raw WHOIS
        $result['raw_whois'] = $this->extractField($data, [
            'raw_whois', 'Raw WHOIS', 'raw', 'whois_data', 'whois',
        ]);
        
        if (empty($result['raw_whois']) && !empty($response)) {
            $result['raw_whois'] = is_string($data) ? $data : json_encode($data, JSON_PRETTY_PRINT);
        }
        
        // Extract domain status codes
        $result['domain_status'] = $this->extractField($data, [
            'status', 'Domain Status', 'domain_status',
        ]);
        
        return $result;
    }
    
    /**
     * Extract field from data array using multiple possible keys
     *
     * @param array $data
     * @param array $keys
     * @return string|null
     */
    private function extractField($data, $keys)
    {
        foreach ($keys as $key) {
            if (isset($data[$key]) && !empty($data[$key])) {
                return is_array($data[$key]) ? implode(', ', $data[$key]) : (string)$data[$key];
            }
        }
        
        return null;
    }
    
    /**
     * Extract name servers from response
     *
     * @param array $data
     * @return array
     */
    private function extractNameServers($data)
    {
        $possibleKeys = [
            'name_servers', 'Name Servers', 'nameservers', 'NameServer',
            'name_server', 'Nserver', 'Name Server',
        ];
        
        foreach ($possibleKeys as $key) {
            if (isset($data[$key])) {
                $value = $data[$key];
                
                if (is_array($value)) {
                    return array_map('trim', array_filter($value));
                }
                
                if (is_string($value)) {
                    // Handle comma-separated or newline-separated
                    $servers = preg_split('/[,\n]+/', $value);
                    return array_map('trim', array_filter($servers));
                }
            }
        }
        
        return [];
    }
    
    /**
     * Extract domain status
     *
     * @param array $data
     * @return array
     */
    private function extractStatus($data)
    {
        $possibleKeys = [
            'status', 'Domain Status', 'domain_status', 'Status',
        ];
        
        foreach ($possibleKeys as $key) {
            if (isset($data[$key])) {
                $value = $data[$key];
                
                if (is_array($value)) {
                    return array_map('trim', array_filter($value));
                }
                
                if (is_string($value)) {
                    return array_map('trim', array_filter(preg_split('/[,\n]+/', $value)));
                }
            }
        }
        
        return [];
    }
    
    /**
     * Make HTTP request
     *
     * @param string $url
     * @return string|false
     */
    private function makeRequest($url)
    {
        $ch = curl_init();
        
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => min(5, $this->timeout),
            CURLOPT_USERAGENT      => 'CloudHost247DomainLookup/' . CLOUDHOST247_DOMAIN_LOOKUP_VERSION . ' (WHMCS Addon)',
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json',
            ],
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        
        if ($response === false || $httpCode !== 200) {
            return false;
        }
        
        return $response;
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
