<?php
/**
 * HostX Domain Lookup - IPinfo API Client
 *
 * Handles IP geolocation and WHOIS lookups via IPinfo API.
 * Primary API for IP-related queries.
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

class IPinfoApi
{
    /**
     * @var string API base URL
     */
    private $baseUrl = 'https://ipinfo.io';
    
    /**
     * @var string API access token
     */
    private $token;
    
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
        $this->token = !empty($config['ipinfo_token']) ? $config['ipinfo_token'] : '';
        $this->timeout = !empty($config['request_timeout']) ? (int)$config['request_timeout'] : 10;
    }
    
    /**
     * Check if API is configured
     *
     * @return bool
     */
    public function isConfigured()
    {
        return !empty($this->token);
    }
    
    /**
     * Perform IP lookup
     *
     * @param string $ip
     * @return array
     */
    public function lookupIp($ip)
    {
        if (!$this->isConfigured()) {
            return [
                'success' => false,
                'error'   => 'IPinfo access token not configured',
                'source'  => 'ipinfo',
            ];
        }
        
        try {
            $url = $this->baseUrl . '/' . urlencode($ip) . '/json?token=' . urlencode($this->token);
            
            $response = $this->makeRequest($url);
            
            if ($response === false) {
                return [
                    'success' => false,
                    'error'   => 'Failed to connect to IPinfo API',
                    'source'  => 'ipinfo',
                ];
            }
            
            $data = json_decode($response, true);
            
            if (json_last_error() !== JSON_ERROR_NONE) {
                return [
                    'success' => false,
                    'error'   => 'Invalid JSON response from IPinfo API',
                    'source'  => 'ipinfo',
                ];
            }
            
            if (isset($data['error']) && isset($data['error']['message'])) {
                return [
                    'success' => false,
                    'error'   => $data['error']['message'],
                    'source'  => 'ipinfo',
                ];
            }
            
            if (isset($data['bogon']) && $data['bogon'] === true) {
                return [
                    'success' => true,
                    'ip'      => $ip,
                    'bogon'   => true,
                    'note'    => 'This is a bogon (reserved/unroutable) IP address',
                    'source'  => 'ipinfo',
                ];
            }
            
            return [
                'success'      => true,
                'ip'           => $ip,
                'hostname'     => $data['hostname'] ?? null,
                'city'         => $data['city'] ?? null,
                'region'       => $data['region'] ?? null,
                'country'      => $data['country'] ?? null,
                'country_name' => $this->getCountryName($data['country'] ?? ''),
                'loc'          => $data['loc'] ?? null,
                'latitude'     => null,
                'longitude'    => null,
                'organization' => $data['org'] ?? null,
                'isp'          => $data['org'] ?? null,
                'asn'          => null,
                'asn_domain'   => null,
                'asn_name'     => null,
                'asn_type'     => null,
                'postal'       => $data['postal'] ?? null,
                'timezone'     => $data['timezone'] ?? null,
                'source'       => 'ipinfo',
            ];
            
        } catch (Exception $e) {
            return [
                'success' => false,
                'error'   => $e->getMessage(),
                'source'  => 'ipinfo',
            ];
        }
    }
    
    /**
     * Get ASN details
     *
     * @param string $asn
     * @return array
     */
    public function lookupAsn($asn)
    {
        if (!$this->isConfigured()) {
            return [
                'success' => false,
                'error'   => 'IPinfo access token not configured',
                'source'  => 'ipinfo',
            ];
        }
        
        try {
            $url = $this->baseUrl . '/' . urlencode($asn) . '/json?token=' . urlencode($this->token);
            
            $response = $this->makeRequest($url);
            
            if ($response === false) {
                return [
                    'success' => false,
                    'error'   => 'Failed to connect to IPinfo API',
                    'source'  => 'ipinfo',
                ];
            }
            
            $data = json_decode($response, true);
            
            if (json_last_error() !== JSON_ERROR_NONE) {
                return [
                    'success' => false,
                    'error'   => 'Invalid JSON response',
                    'source'  => 'ipinfo',
                ];
            }
            
            return [
                'success'     => true,
                'asn'         => $asn,
                'name'        => $data['name'] ?? null,
                'domain'      => $data['domain'] ?? null,
                'route'       => $data['route'] ?? null,
                'type'        => $data['type'] ?? null,
                'country'     => $data['country'] ?? null,
                'country_name'=> $this->getCountryName($data['country'] ?? ''),
                'source'      => 'ipinfo',
            ];
            
        } catch (Exception $e) {
            return [
                'success' => false,
                'error'   => $e->getMessage(),
                'source'  => 'ipinfo',
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
     * Get country name from ISO code
     *
     * @param string $code
     * @return string|null
     */
    private function getCountryName($code)
    {
        if (empty($code)) {
            return null;
        }
        
        $countries = [
            'US' => 'United States', 'GB' => 'United Kingdom', 'CA' => 'Canada',
            'AU' => 'Australia', 'DE' => 'Germany', 'FR' => 'France',
            'JP' => 'Japan', 'CN' => 'China', 'IN' => 'India',
            'BR' => 'Brazil', 'RU' => 'Russia', 'KR' => 'South Korea',
            'NL' => 'Netherlands', 'SG' => 'Singapore', 'SE' => 'Sweden',
            'CH' => 'Switzerland', 'IT' => 'Italy', 'ES' => 'Spain',
            'PL' => 'Poland', 'IE' => 'Ireland', 'FI' => 'Finland',
            'NO' => 'Norway', 'DK' => 'Denmark', 'BE' => 'Belgium',
            'AT' => 'Austria', 'NZ' => 'New Zealand', 'ZA' => 'South Africa',
            'MX' => 'Mexico', 'AR' => 'Argentina', 'CL' => 'Chile',
            'CO' => 'Colombia', 'PE' => 'Peru', 'VE' => 'Venezuela',
            'MY' => 'Malaysia', 'TH' => 'Thailand', 'ID' => 'Indonesia',
            'PH' => 'Philippines', 'VN' => 'Vietnam', 'TW' => 'Taiwan',
            'HK' => 'Hong Kong', 'IL' => 'Israel', 'TR' => 'Turkey',
            'AE' => 'United Arab Emirates', 'SA' => 'Saudi Arabia',
            'UA' => 'Ukraine', 'CZ' => 'Czech Republic', 'RO' => 'Romania',
            'HU' => 'Hungary', 'GR' => 'Greece', 'PT' => 'Portugal',
        ];
        
        return $countries[$code] ?? $code;
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
