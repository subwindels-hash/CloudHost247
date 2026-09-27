<?php
/**
 * HostX Domain Lookup - IPWho API Client
 *
 * Handles IP geolocation via IPWho API.
 * Fallback API for IP-related queries.
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

class IPWhoApi
{
    /**
     * @var string API base URL
     */
    private $baseUrl = 'https://ipwho.is';
    
    /**
     * @var string API key (optional)
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
        $this->apiKey = !empty($config['ipwho_api_key']) ? $config['ipwho_api_key'] : '';
        $this->timeout = !empty($config['request_timeout']) ? (int)$config['request_timeout'] : 10;
    }
    
    /**
     * Perform IP lookup
     *
     * @param string $ip
     * @return array
     */
    public function lookupIp($ip)
    {
        try {
            $url = $this->baseUrl . '/' . urlencode($ip);
            
            if (!empty($this->apiKey)) {
                $url .= '?key=' . urlencode($this->apiKey);
            }
            
            $response = $this->makeRequest($url);
            
            if ($response === false) {
                return [
                    'success' => false,
                    'error'   => 'Failed to connect to IPWho API',
                    'source'  => 'ipwho',
                ];
            }
            
            $data = json_decode($response, true);
            
            if (json_last_error() !== JSON_ERROR_NONE) {
                return [
                    'success' => false,
                    'error'   => 'Invalid JSON response from IPWho API',
                    'source'  => 'ipwho',
                ];
            }
            
            if (isset($data['success']) && $data['success'] === false) {
                return [
                    'success' => false,
                    'error'   => $data['message'] ?? 'Unknown error from IPWho API',
                    'source'  => 'ipwho',
                ];
            }
            
            // Parse ASN info
            $asn = null;
            $asnDomain = null;
            $asnName = null;
            $asnType = null;
            
            if (isset($data['connection']['asn'])) {
                $asn = $data['connection']['asn'];
            }
            if (isset($data['connection']['org'])) {
                $asnName = $data['connection']['org'];
            }
            if (isset($data['connection']['domain'])) {
                $asnDomain = $data['connection']['domain'];
            }
            if (isset($data['connection']['route'])) {
                $asnType = $data['connection']['route'];
            }
            
            return [
                'success'      => true,
                'ip'           => $ip,
                'hostname'     => null,
                'city'         => $data['city'] ?? null,
                'region'       => $data['region'] ?? null,
                'country'      => $data['country_code'] ?? null,
                'country_name' => $data['country'] ?? null,
                'loc'          => null,
                'latitude'     => $data['latitude'] ?? null,
                'longitude'    => $data['longitude'] ?? null,
                'organization' => $data['connection']['org'] ?? null,
                'isp'          => $data['connection']['isp'] ?? ($data['connection']['org'] ?? null),
                'asn'          => $asn,
                'asn_domain'   => $asnDomain,
                'asn_name'     => $asnName,
                'asn_type'     => $asnType,
                'postal'       => $data['postal'] ?? null,
                'timezone'     => $data['timezone']['id'] ?? null,
                'source'       => 'ipwho',
            ];
            
        } catch (Exception $e) {
            return [
                'success' => false,
                'error'   => $e->getMessage(),
                'source'  => 'ipwho',
            ];
        }
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
            CURLOPT_USERAGENT      => 'HostXDomainLookup/' . HOSTX_DOMAIN_LOOKUP_VERSION . ' (WHMCS Addon)',
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json',
            ],
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
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
