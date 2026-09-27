<?php
/**
 * Network Tools Module
 * Port checker, MAC address lookup/generator, ASN WHOIS
 */

class NetworkTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * Port Checker
     */
    public function portChecker($params) {
        $host = $params['host'] ?? '';
        $ports = $params['ports'] ?? '';
        $timeout = min((int)($params['timeout'] ?? 5), 30);
        
        if (empty($host)) {
            throw new Exception('Host is required');
        }
        
        $host = $this->sanitizeHost($host);
        
        // Parse ports
        if (empty($ports)) {
            $portList = [21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 3389, 8080, 8443];
        } else {
            $portList = $this->parsePortList($ports);
        }
        
        $portList = array_slice($portList, 0, 50); // Limit to 50 ports
        
        $results = [];
        $openPorts = 0;
        
        foreach ($portList as $port) {
            $startTime = microtime(true);
            $socket = @fsockopen($host, $port, $errno, $errstr, $timeout);
            $responseTime = round((microtime(true) - $startTime) * 1000, 2);
            
            if ($socket) {
                fclose($socket);
                $openPorts++;
                $results[] = [
                    'port' => $port,
                    'status' => 'OPEN',
                    'service' => $this->getServiceName($port),
                    'response_time_ms' => $responseTime,
                    'protocol' => in_array($port, [465, 636, 989, 990, 992, 993, 994, 995]) ? 'TCP/SSL' : 'TCP',
                ];
            } else {
                $results[] = [
                    'port' => $port,
                    'status' => 'CLOSED',
                    'service' => $this->getServiceName($port),
                    'response_time_ms' => $responseTime,
                    'error' => $errstr ?: 'Connection refused',
                ];
            }
        }
        
        return [
            'host' => $host,
            'ports_scanned' => count($portList),
            'open_ports' => $openPorts,
            'closed_ports' => count($portList) - $openPorts,
            'scan_type' => empty($ports) ? 'common_ports' : 'custom_ports',
            'results' => $results,
            'security_note' => $openPorts > 0 ? 'Open ports detected - review firewall rules' : 'All tested ports are closed',
        ];
    }
    
    /**
     * MAC Address Lookup
     */
    public function macLookup($params) {
        $mac = $params['mac'] ?? '';
        
        if (empty($mac)) {
            throw new Exception('MAC address is required');
        }
        
        $mac = strtoupper(preg_replace('/[^0-9a-fA-F]/', '', $mac));
        
        if (strlen($mac) !== 12) {
            throw new Exception('Invalid MAC address format');
        }
        
        $oui = substr($mac, 0, 6);
        
        // Common OUIs database (simplified)
        $ouis = $this->getOUIDatabase();
        
        $vendor = $ouis[$oui] ?? $ouis[substr($mac, 0, 6)] ?? 'Unknown';
        
        // Formatted MAC
        $formats = [
            'colon' => implode(':', str_split($mac, 2)),
            'dash' => implode('-', str_split($mac, 2)),
            'dot' => implode('.', str_split($mac, 4)),
            'plain' => $mac,
            'cisco' => substr($mac, 0, 4) . '.' . substr($mac, 4, 4) . '.' . substr($mac, 8, 4),
        ];
        
        return [
            'mac_address' => $mac,
            'vendor' => $vendor,
            'oui' => $oui,
            'formats' => $formats,
            'is_valid' => true,
            'is_local' => $this->isLocallyAdministered($mac),
            'multicast' => (hexdec(substr($mac, 0, 1)) & 1) === 1,
        ];
    }
    
    /**
     * MAC Address Generator
     */
    public function macGenerator($params) {
        $count = min((int)($params['count'] ?? 5), 50);
        $format = strtolower($params['format'] ?? 'colon');
        $vendor = $params['vendor'] ?? 'random';
        $multicast = (bool)($params['multicast'] ?? false);
        $local = (bool)($params['local'] ?? false);
        
        $addresses = [];
        
        for ($i = 0; $i < $count; $i++) {
            $mac = $this->generateRandomMAC($vendor, $multicast, $local);
            $addresses[] = [
                'plain' => $mac,
                'formatted' => $this->formatMAC($mac, $format),
                'vendor' => $this->lookupVendor($mac),
            ];
        }
        
        return [
            'generated' => $addresses,
            'count' => $count,
            'format' => $format,
            'options' => [
                'multicast' => $multicast,
                'locally_administered' => $local,
            ],
        ];
    }
    
    /**
     * ASN WHOIS Lookup
     */
    public function asnWhois($params) {
        $asn = $params['asn'] ?? '';
        $ip = $params['ip'] ?? '';
        
        if (empty($asn) && empty($ip)) {
            throw new Exception('ASN number or IP address is required');
        }
        
        if (!empty($asn)) {
            // Strip "AS" prefix if present
            $asn = preg_replace('/^AS/i', '', trim($asn));
            
            if (!is_numeric($asn) || $asn < 1 || $asn > 4294967295) {
                throw new Exception('Invalid ASN number');
            }
            
            // Query WHOIS for ASN
            $whoisData = $this->queryASNWhois($asn);
            $parsed = $this->parseASNWhois($whoisData);
            
            return [
                'asn' => 'AS' . $asn,
                'raw' => $whoisData,
                'parsed' => $parsed,
                'organization' => $parsed['OrgName'] ?? $parsed['descr'] ?? $parsed['owner'] ?? 'Unknown',
                'country' => $parsed['Country'] ?? $parsed['country'] ?? 'Unknown',
                'routes' => $parsed['route'] ?? [],
            ];
        }
        
        // IP-based ASN lookup
        $ip = filter_var(trim($ip), FILTER_VALIDATE_IP);
        if (!$ip) {
            throw new Exception('Invalid IP address');
        }
        
        // Try to get ASN from IP using Team Cymru or similar
        $asnInfo = $this->getASNForIP($ip);
        
        return [
            'ip' => $ip,
            'asn' => $asnInfo['asn'] ?? 'Unknown',
            'organization' => $asnInfo['org'] ?? 'Unknown',
            'country' => $asnInfo['country'] ?? 'Unknown',
            'route' => $asnInfo['route'] ?? null,
        ];
    }
    
    // ==================== HELPER METHODS ====================
    
    private function sanitizeHost($host) {
        $host = strtolower(trim($host));
        $host = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $host);
        $host = preg_replace('/\/.*$/', '', $host);
        return preg_replace('/[^a-z0-9.\-]/', '', $host);
    }
    
    private function parsePortList($ports) {
        $result = [];
        $parts = explode(',', $ports);
        
        foreach ($parts as $part) {
            $part = trim($part);
            if (strpos($part, '-') !== false) {
                list($start, $end) = explode('-', $part);
                $start = (int)trim($start);
                $end = (int)trim($end);
                if ($start > 0 && $end > 0 && $start <= 65535 && $end <= 65535) {
                    $result = array_merge($result, range($start, min($end, $start + 100)));
                }
            } else {
                $port = (int)$part;
                if ($port > 0 && $port <= 65535) {
                    $result[] = $port;
                }
            }
        }
        
        return array_unique($result);
    }
    
    private function getServiceName($port) {
        $services = [
            21 => 'FTP',
            22 => 'SSH',
            23 => 'Telnet',
            25 => 'SMTP',
            53 => 'DNS',
            80 => 'HTTP',
            110 => 'POP3',
            143 => 'IMAP',
            443 => 'HTTPS',
            465 => 'SMTPS',
            587 => 'SMTP (Submission)',
            993 => 'IMAPS',
            995 => 'POP3S',
            3306 => 'MySQL',
            3389 => 'RDP',
            5432 => 'PostgreSQL',
            5900 => 'VNC',
            6379 => 'Redis',
            8080 => 'HTTP Proxy',
            8443 => 'HTTPS Alt',
            9200 => 'Elasticsearch',
        ];
        
        return $services[$port] ?? 'Unknown';
    }
    
    private function getOUIDatabase() {
        return [
            '001B11' => 'Cisco Systems',
            '001B21' => 'Apple',
            '0021CC' => 'Samsung',
            '0022FA' => 'Hon Hai Precision',
            '0024D6' => 'Intel Corporate',
            '0025BC' => 'Hewlett-Packard',
            '0026BB' => 'Apple',
            '0026C6' => 'HTC',
            '00270D' => 'Hewlett-Packard',
            '0028F8' => 'Intel Corporate',
            '002A10' => 'Cisco',
            '003048' => 'Hewlett-Packard',
            '0050BA' => 'D-Link',
            '0050FC' => 'Cisco',
            '0050EF' => 'Apple',
            '0050E4' => 'Apple',
            '0060B0' => 'Hewlett-Packard',
            '00E018' => 'Asustek',
            '00E04C' => 'Realtek',
            '00E0FC' => 'Intel',
            '080007' => 'Apple',
            '080028' => 'Texas Instruments',
            '080030' => 'Apple',
            '0C413E' => 'Google',
            '14B31F' => 'Intel',
            '18B430' => 'Samsung',
            '1C1B0D' => 'Samsung',
            '1C5C60' => 'Apple',
            '1C66AA' => 'Google',
            '24DBED' => 'Apple',
            '28CFE9' => 'Apple',
            '2C3E2B' => 'Hewlett-Packard',
            '2C7BF1' => 'Hewlett-Packard',
            '30F772' => 'Cisco',
            '34A84E' => 'Hewlett-Packard',
            '3C5A37' => 'Google',
            '3C5AB4' => 'Google',
            '3C970E' => 'Hewlett-Packard',
            '40A8F0' => 'Hewlett-Packard',
            '44D7CC' => 'Hewlett-Packard',
            '48D705' => 'Hewlett-Packard',
            '4C3488' => 'Intel Corporate',
            '4C8093' => 'Apple',
            '501AC5' => 'Hewlett-Packard',
            '5057A8' => 'Cisco',
            '54275E' => 'Apple',
            '5480DD' => 'Motorola',
            '54B802' => 'Hewlett-Packard',
            '54E1AD' => 'Google',
            '5800E3' => 'Liteon',
            '5867C8' => 'Microsoft',
            '5C260A' => 'Hewlett-Packard',
            '5C3E1B' => 'Nintendo',
            '607B5E' => 'Intel',
            '64A5C3' => 'Apple',
            '64B5C6' => 'Nintendo',
            '64B9E8' => 'Microsoft',
            '64D4DA' => 'Intel Corporate',
            '681729' => 'Google',
            '688F84' => 'Hewlett-Packard',
            '68FB95' => 'Intel Corporate',
            '6C3BE5' => 'Hewlett-Packard',
            '6C8814' => 'Intel Corporate',
            '6C9B02' => 'Nintendo',
            '6CADDE' => 'Microsoft',
            '705A0F' => 'Hewlett-Packard',
            '74E14A' => 'Hewlett-Packard',
            '78ACC0' => 'Hewlett-Packard',
            '78CA39' => 'Google',
            '78D75F' => 'Hewlett-Packard',
            '7C784E' => 'Hewlett-Packard',
            '7C8EE4' => 'Texas Instruments',
            '7CE9D5' => 'Hon Hai Precision',
            '801F02' => 'Apple',
            '807ABF' => 'Hewlett-Packard',
            '84A6C8' => 'Intel Corporate',
            '84D4D4' => 'Intel Corporate',
            '88E87F' => 'Hewlett-Packard',
            '8C1645' => 'Hewlett-Packard',
            '8C705A' => 'Apple',
            '90E7C4' => 'HTC',
            '9803D8' => 'Apple',
            '9C99A0' => 'Xiaomi',
            'A01828' => 'Dell',
            'A088B4' => 'Intel Corporate',
            'A44E31' => 'Intel Corporate',
            'A45D36' => 'Hewlett-Packard',
            'A4B197' => 'Intel Corporate',
            'A4C361' => 'Apple',
            'A4D1D2' => 'Apple',
            'A81B5D' => 'Google',
            'AC2B6E' => 'Intel Corporate',
            'AC87A3' => 'Hewlett-Packard',
            'ACDE48' => 'Hewlett-Packard',
            'B0BE76' => 'Apple',
            'B0D09C' => 'Sony',
            'B0EED5' => 'Motorola',
            'B4B676' => 'Hewlett-Packard',
            'B4E7AD' => 'Hewlett-Packard',
            'B8AC6F' => 'Hewlett-Packard',
            'B8E856' => 'Hewlett-Packard',
            'B8F882' => 'Apple',
            'C02C5C' => 'Siemens',
            'C06C0A' => 'Hewlett-Packard',
            'C4346B' => 'Hewlett-Packard',
            'C434EC' => 'Google',
            'C434F9' => 'Hewlett-Packard',
            'C89F42' => 'Hewlett-Packard',
            'C8D3FF' => 'Intel Corporate',
            'C8F750' => 'Hewlett-Packard',
            'CC3F1D' => 'Cisco',
            'CC6DEA' => 'Hewlett-Packard',
            'D028F6' => 'Hewlett-Packard',
            'D48564' => 'Hewlett-Packard',
            'D4C9EF' => 'Hewlett-Packard',
            'D8CB8A' => 'Micro-Star',
            'D8D385' => 'Hewlett-Packard',
            'D8D43C' => 'Microsoft',
            'DC4A9E' => 'Cisco',
            'E01D20' => 'Hewlett-Packard',
            'E0D55C' => 'Hewlett-Packard',
            'E4A471' => 'Hewlett-Packard',
            'E4D53D' => 'Hewlett-Packard',
            'EC8EB5' => 'Hewlett-Packard',
            'ECF4BB' => 'Dell',
            'F02F4B' => 'Hewlett-Packard',
            'F0DEF1' => 'Hewlett-Packard',
            'F4CE46' => 'Hewlett-Packard',
            'F4F5A8' => 'Hewlett-Packard',
            'FC15B4' => 'Hewlett-Packard',
            'FC3FDB' => 'Hewlett-Packard',
            'FCF152' => 'Intel Corporate',
        ];
    }
    
    private function lookupVendor($mac) {
        $oui = substr(strtoupper($mac), 0, 6);
        $ouis = $this->getOUIDatabase();
        return $ouis[$oui] ?? 'Unknown';
    }
    
    private function generateRandomMAC($vendor, $multicast, $local) {
        $firstByte = 0;
        
        if ($multicast) {
            $firstByte |= 0x01;
        }
        
        if ($local) {
            $firstByte |= 0x02;
        }
        
        if ($vendor !== 'random' && $vendor !== '') {
            $ouis = $this->getOUIDatabase();
            $matchingOUIs = array_filter(array_keys($ouis), function($k) use ($vendor) {
                return stripos($ouis[$k], $vendor) !== false;
            });
            
            if (!empty($matchingOUIs)) {
                $oui = strtoupper((string)array_values($matchingOUIs)[0]);
                $firstByte = hexdec(substr($oui, 0, 2));
                
                if ($multicast) $firstByte |= 0x01;
                if ($local) $firstByte |= 0x02;
                
                $mac = strtoupper(sprintf('%02X', $firstByte)) . substr($oui, 2, 4);
                for ($i = 0; $i < 6; $i++) {
                    $mac .= sprintf('%02X', random_int(0, 255));
                }
                return $mac;
            }
        }
        
        // Random MAC
        $mac = sprintf('%02X', $firstByte);
        for ($i = 0; $i < 5; $i++) {
            $mac .= sprintf('%02X', random_int(0, 255));
        }
        
        return strtoupper($mac);
    }
    
    private function formatMAC($mac, $format) {
        switch ($format) {
            case 'colon':
                return implode(':', str_split($mac, 2));
            case 'dash':
                return implode('-', str_split($mac, 2));
            case 'dot':
                return implode('.', str_split($mac, 4));
            case 'cisco':
                return substr($mac, 0, 4) . '.' . substr($mac, 4, 4) . '.' . substr($mac, 8, 4);
            case 'plain':
            default:
                return $mac;
        }
    }
    
    private function isLocallyAdministered($mac) {
        $firstByte = hexdec(substr($mac, 0, 2));
        return (bool)(($firstByte >> 1) & 1);
    }
    
    private function queryASNWhois($asn) {
        $servers = ['whois.radb.net', 'whois.ripe.net'];
        
        foreach ($servers as $server) {
            $socket = @fsockopen($server, 43, $errno, $errstr, 10);
            if ($socket) {
                fputs($socket, "AS{$asn}\r\n");
                $result = '';
                while (!feof($socket)) {
                    $result .= fgets($socket, 128);
                }
                fclose($socket);
                
                if (!empty($result) && strpos($result, 'Not found') === false) {
                    return $result;
                }
            }
        }
        
        return 'No WHOIS data available for AS' . $asn;
    }
    
    private function parseASNWhois($data) {
        $parsed = [];
        $lines = explode("\n", $data);
        $routes = [];
        
        foreach ($lines as $line) {
            if (preg_match('/^([A-Za-z\-]+):\s*(.+)$/', $line, $m)) {
                $key = trim($m[1]);
                $value = trim($m[2]);
                
                if ($key === 'route' || $key === 'route6') {
                    $routes[] = $value;
                } else {
                    $parsed[$key] = $value;
                }
            }
        }
        
        $parsed['route'] = $routes;
        return $parsed;
    }
    
    private function getASNForIP($ip) {
        // Try Team Cymru DNS-based ASN lookup
        $isIPv6 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6);
        
        if ($isIPv6) {
            // IPv6 ASN lookup via DNS
            $arpa = $this->ip6ToArpa($ip);
            $lookup = "{$arpa}.origin6.asn.cymru.com";
        } else {
            // IPv4 ASN lookup via DNS
            $reversed = implode('.', array_reverse(explode('.', $ip)));
            $lookup = "{$reversed}.origin.asn.cymru.com";
        }
        
        $records = @dns_get_record($lookup, DNS_TXT);
        
        if (!empty($records) && isset($records[0]['txt'])) {
            $txt = $records[0]['txt'];
            // Parse format: "ASN | Route | Country | Registry | Date"
            $parts = explode(' | ', $txt);
            
            return [
                'asn' => isset($parts[0]) ? 'AS' . trim($parts[0]) : 'Unknown',
                'route' => $parts[1] ?? null,
                'country' => $parts[2] ?? 'Unknown',
                'registry' => $parts[3] ?? null,
            ];
        }
        
        return ['asn' => 'Unknown', 'country' => 'Unknown'];
    }
    
    private function ip6ToArpa($ip) {
        $hex = bin2hex(inet_pton($ip));
        $nibbles = str_split($hex);
        $reversed = array_reverse($nibbles);
        return implode('.', $reversed);
    }
}