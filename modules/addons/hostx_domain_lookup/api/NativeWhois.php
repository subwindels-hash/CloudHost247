<?php
/**
 * HostX Tools - Native PHP WHOIS Client
 *
 * Performs WHOIS lookups directly via port 43.
 * Fallback method when APIs are unavailable.
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

class NativeWhois
{
    /**
     * @var int Connection timeout
     */
    private $timeout = 10;
    
    /**
     * @var int Port for WHOIS queries
     */
    private $port = 43;
    
    /**
     * @var array WHOIS servers for TLDs
     */
    private $whoisServers = [
        'com'    => 'whois.verisign-grs.com',
        'net'    => 'whois.verisign-grs.com',
        'org'    => 'whois.pir.org',
        'info'   => 'whois.afilias.net',
        'biz'    => 'whois.biz',
        'us'     => 'whois.nic.us',
        'uk'     => 'whois.nic.uk',
        'co.uk'  => 'whois.nic.uk',
        'ca'     => 'whois.cira.ca',
        'de'     => 'whois.denic.de',
        'eu'     => 'whois.eu',
        'fr'     => 'whois.nic.fr',
        'au'     => 'whois.auda.org.au',
        'com.au' => 'whois.auda.org.au',
        'nl'     => 'whois.sidn.nl',
        'it'     => 'whois.nic.it',
        'es'     => 'whois.nic.es',
        'pl'     => 'whois.dns.pl',
        'br'     => 'whois.registro.br',
        'jp'     => 'whois.jprs.jp',
        'in'     => 'whois.registry.in',
        'co.in'  => 'whois.registry.in',
        'io'     => 'whois.nic.io',
        'me'     => 'whois.nic.me',
        'tv'     => 'whois.nic.tv',
        'cc'     => 'whois.nic.cc',
        'mobi'   => 'whois.dotmobiregistry.net',
        'asia'   => 'whois.nic.asia',
        'name'   => 'whois.nic.name',
        'ws'     => 'whois.website.ws',
        'co'     => 'whois.nic.co',
        'pro'    => 'whois.nic.pro',
        'xxx'    => 'whois.nic.xxx',
        'tel'    => 'whois.nic.tel',
        'travel' => 'whois.nic.travel',
        'jobs'   => 'whois.nic.jobs',
        'aero'   => 'whois.aero',
        'coop'   => 'whois.nic.coop',
        'museum' => 'whois.museum',
        'int'    => 'whois.iana.org',
        'edu'    => 'whois.educause.edu',
        'gov'    => 'whois.nic.gov',
        'mil'    => 'whois.nic.mil',
        'app'    => 'whois.nic.google',
        'dev'    => 'whois.nic.google',
        'page'   => 'whois.nic.google',
        'cloud'  => 'whois.nic.cloud',
        'online' => 'whois.nic.online',
        'site'   => 'whois.nic.site',
        'xyz'    => 'whois.nic.xyz',
        'club'   => 'whois.nic.club',
        'store'  => 'whois.nic.store',
        'space'  => 'whois.nic.space',
        'live'   => 'whois.nic.live',
        'news'   => 'whois.nic.news',
        'blog'   => 'whois.nic.blog',
        'work'   => 'whois.nic.work',
    ];
    
    /**
     * Perform WHOIS lookup for a domain
     *
     * @param string $domain
     * @return array
     */
    public function lookup($domain)
    {
        try {
            $domain = $this->sanitizeDomain($domain);
            
            if (empty($domain)) {
                return [
                    'success' => false,
                    'error'   => 'Invalid domain name',
                    'source'  => 'native_whois',
                ];
            }
            
            // Get WHOIS server for this TLD
            $whoisServer = $this->getWhoisServer($domain);
            
            if (empty($whoisServer)) {
                return [
                    'success' => false,
                    'error'   => 'No WHOIS server found for this domain TLD',
                    'source'  => 'native_whois',
                ];
            }
            
            // Connect and query
            $rawWhois = $this->queryServer($whoisServer, $domain);
            
            if ($rawWhois === false) {
                return [
                    'success' => false,
                    'error'   => 'Failed to connect to WHOIS server: ' . $whoisServer,
                    'source'  => 'native_whois',
                ];
            }
            
            // Parse the WHOIS data
            $parsed = $this->parseWhoisData($rawWhois);
            
            return [
                'success'       => true,
                'domain'        => $domain,
                'registrar'     => $parsed['registrar'],
                'creation_date' => $parsed['creation_date'],
                'expiry_date'   => $parsed['expiry_date'],
                'name_servers'  => $parsed['name_servers'],
                'status'        => $parsed['status'],
                'domain_status' => $parsed['domain_status'],
                'raw_whois'     => $rawWhois,
                'source'        => 'native_whois',
                'whois_server'  => $whoisServer,
            ];
            
        } catch (Exception $e) {
            return [
                'success' => false,
                'error'   => $e->getMessage(),
                'source'  => 'native_whois',
            ];
        }
    }
    
    /**
     * Check domain availability via WHOIS
     *
     * @param string $domain
     * @return array
     */
    public function checkAvailability($domain)
    {
        $result = $this->lookup($domain);
        
        if (!$result['success']) {
            return [
                'success'   => false,
                'error'     => $result['error'],
                'source'    => 'native_whois',
            ];
        }
        
        $rawWhois = strtolower($result['raw_whois']);
        
        // Check for common "not found" / "available" indicators
        $availablePatterns = [
            'no match',
            'not found',
            'no entries found',
            'domain not found',
            'status:\s+free',
            'status:\s+available',
            'no data found',
            'not registered',
            'no information available',
            'domain status:\s+free',
            'nothing found',
            'does not exist',
        ];
        
        $isAvailable = false;
        foreach ($availablePatterns as $pattern) {
            if (preg_match('/' . $pattern . '/i', $rawWhois)) {
                $isAvailable = true;
                break;
            }
        }
        
        return [
            'success'   => true,
            'domain'    => $domain,
            'available' => $isAvailable,
            'registrar' => $isAvailable ? null : $result['registrar'],
            'source'    => 'native_whois',
        ];
    }
    
    /**
     * Query WHOIS server
     *
     * @param string $server
     * @param string $query
     * @return string|false
     */
    private function queryServer($server, $query)
    {
        $socket = @fsockopen($server, $this->port, $errno, $errstr, $this->timeout);
        
        if (!$socket) {
            return false;
        }
        
        // Set stream timeout
        stream_set_timeout($socket, $this->timeout);
        
        // Send query
        fwrite($socket, $query . "\r\n");
        
        // Read response
        $response = '';
        while (!feof($socket)) {
            $response .= fgets($socket, 128);
            
            // Check for timeout
            $info = stream_get_meta_data($socket);
            if ($info['timed_out']) {
                fclose($socket);
                return false;
            }
        }
        
        fclose($socket);
        
        return trim($response);
    }
    
    /**
     * Get WHOIS server for domain
     *
     * @param string $domain
     * @return string|null
     */
    private function getWhoisServer($domain)
    {
        $parts = explode('.', $domain);
        
        // Check for multi-part TLDs first (e.g., co.uk)
        if (count($parts) >= 3) {
            $tld2 = $parts[count($parts) - 2] . '.' . $parts[count($parts) - 1];
            if (isset($this->whoisServers[$tld2])) {
                return $this->whoisServers[$tld2];
            }
        }
        
        // Check single-part TLD
        $tld = end($parts);
        if (isset($this->whoisServers[$tld])) {
            return $this->whoisServers[$tld];
        }
        
        // Try IANA for unknown TLDs
        return $this->queryIANA($tld);
    }
    
    /**
     * Query IANA for WHOIS server of unknown TLD
     *
     * @param string $tld
     * @return string|null
     */
    private function queryIANA($tld)
    {
        $response = $this->queryServer('whois.iana.org', $tld);
        
        if ($response === false) {
            return null;
        }
        
        // Extract WHOIS server from IANA response
        if (preg_match('/whois:\s+([\w\.-]+)/i', $response, $matches)) {
            return trim($matches[1]);
        }
        
        return null;
    }
    
    /**
     * Parse WHOIS data into structured format
     *
     * @param string $rawWhois
     * @return array
     */
    private function parseWhoisData($rawWhois)
    {
        $result = [
            'registrar'     => null,
            'creation_date' => null,
            'expiry_date'   => null,
            'name_servers'  => [],
            'status'        => [],
            'domain_status' => [],
        ];
        
        $lines = explode("\n", $rawWhois);
        $nameServers = [];
        $statusCodes = [];
        
        foreach ($lines as $line) {
            $line = trim($line);
            
            if (empty($line) || strpos($line, '%') === 0 || strpos($line, '#') === 0) {
                continue;
            }
            
            // Split on first colon
            $pos = strpos($line, ':');
            if ($pos === false) {
                continue;
            }
            
            $key = strtolower(trim(substr($line, 0, $pos)));
            $value = trim(substr($line, $pos + 1));
            
            // Registrar
            if (empty($result['registrar']) && 
                (strpos($key, 'registrar') !== false || strpos($key, 'sponsoring registrar') !== false)) {
                if (strpos($key, 'iana') === false && strpos($key, 'url') === false) {
                    $result['registrar'] = $value;
                }
            }
            
            // Creation date
            if (empty($result['creation_date']) && 
                (strpos($key, 'creation date') !== false || 
                 strpos($key, 'created') !== false ||
                 strpos($key, 'domain create date') !== false)) {
                $result['creation_date'] = $this->normalizeDate($value);
            }
            
            // Expiry date
            if (empty($result['expiry_date']) && 
                (strpos($key, 'expir') !== false || 
                 strpos($key, 'registry expiry') !== false ||
                 strpos($key, 'renewal date') !== false ||
                 strpos($key, 'paid-till') !== false)) {
                $result['expiry_date'] = $this->normalizeDate($value);
            }
            
            // Name servers
            if ((strpos($key, 'name server') !== false || 
                 strpos($key, 'nserver') !== false ||
                 $key === 'ns') && !empty($value)) {
                $ns = strtolower(preg_replace('/\s+/', '', $value));
                if (!in_array($ns, $nameServers)) {
                    $nameServers[] = $ns;
                }
            }
            
            // Domain status
            if (strpos($key, 'domain status') !== false || strpos($key, 'status') !== false) {
                if (!empty($value) && $value !== 'ok') {
                    $statusCodes[] = $value;
                }
            }
        }
        
        $result['name_servers'] = $nameServers;
        $result['status'] = $statusCodes;
        $result['domain_status'] = $statusCodes;
        
        return $result;
    }
    
    /**
     * Normalize date format
     *
     * @param string $date
     * @return string
     */
    private function normalizeDate($date)
    {
        if (empty($date)) {
            return null;
        }
        
        // Try common formats
        $formats = [
            'Y-m-d',
            'Y-m-d H:i:s',
            'd-m-Y',
            'd/m/Y',
            'm/d/Y',
            'Ymd',
            'YmdHis',
            'D M d H:i:s Y',  // RFC format
            'M d Y',
        ];
        
        foreach ($formats as $format) {
            $dt = \DateTime::createFromFormat($format, $date);
            if ($dt !== false) {
                return $dt->format('Y-m-d H:i:s');
            }
        }
        
        // Try strtotime as last resort
        $timestamp = strtotime($date);
        if ($timestamp !== false) {
            return date('Y-m-d H:i:s', $timestamp);
        }
        
        return $date;
    }
    
    /**
     * Sanitize domain name
     *
     * @param string $domain
     * @return string
     */
    private function sanitizeDomain($domain)
    {
        $domain = strtolower(trim($domain));
        $domain = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $domain);
        $domain = parse_url('http://' . $domain, PHP_URL_HOST) ?: $domain;
        $domain = preg_replace('/[^a-z0-9\.\-]/', '', $domain);
        
        return $domain;
    }
}
