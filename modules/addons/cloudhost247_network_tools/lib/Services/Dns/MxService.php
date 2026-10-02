<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;

/**
 * MX Lookup (docs section 7): exchangers with priority, addresses, reverse DNS
 * and an optional, clearly-labelled port 25 reachability test.
 */
final class MxService extends Service
{
    /** Well-known mail providers, matched on the published MX hostname suffix. */
    private static $providers = array(
        'google.com' => 'Google Workspace', 'googlemail.com' => 'Google Workspace',
        'outlook.com' => 'Microsoft 365', 'protection.outlook.com' => 'Microsoft 365',
        'mail.protection.outlook.com' => 'Microsoft 365', 'office365.com' => 'Microsoft 365',
        'zoho.com' => 'Zoho Mail', 'zoho.eu' => 'Zoho Mail',
        'mimecast.com' => 'Mimecast', 'pphosted.com' => 'Proofpoint',
        'messagelabs.com' => 'Symantec Email Security', 'barracudanetworks.com' => 'Barracuda',
        'secureserver.net' => 'GoDaddy', 'registrar-servers.com' => 'Namecheap',
        'mailgun.org' => 'Mailgun', 'sendgrid.net' => 'SendGrid',
        'cloudflare.net' => 'Cloudflare Email Routing', 'improvmx.com' => 'ImprovMX',
        'protonmail.ch' => 'Proton Mail', 'mailbox.org' => 'mailbox.org',
        'ionos.com' => 'IONOS', 'kundenserver.de' => 'IONOS',
        'ovh.net' => 'OVH', 'ovh.com' => 'OVH', 'soyoustart.com' => 'SoYouStart',
        'lws.fr' => 'LWS', 'one.com' => 'One.com', 'hostinger.com' => 'Hostinger',
        'cpanel.net' => 'cPanel server',
    );

    protected function execute()
    {
        $domain = $this->input['domain'];
        $response = $this->querySystem($domain, 'MX');
        if (!$response['ok']) {
            $failure = $this->dnsFailure($response, 'The MX lookup failed');
            $failure->withMeta($this->meta($response, array('records' => array(), 'domain' => $domain)));
            return $failure;
        }
        $exchangers = array();
        foreach ($response['records'] as $record) {
            if ($record['type'] !== 'MX') {
                continue;
            }
            $exchangers[] = array(
                'hostname' => isset($record['target']) ? $record['target'] : $record['value'],
                'priority' => isset($record['priority']) ? (int) $record['priority'] : null,
                'ttl' => isset($record['ttl']) ? (int) $record['ttl'] : null,
            );
        }
        usort($exchangers, function ($a, $b) {
            if ($a['priority'] === $b['priority']) { return strcmp($a['hostname'], $b['hostname']); }
            return $a['priority'] < $b['priority'] ? -1 : 1;
        });
        $checkReachability = !empty($this->input['check_reachability']);
        $rows = array();
        foreach ($exchangers as $exchanger) {
            $row = array_merge($exchanger, array(
                'ipv4' => array(), 'ipv6' => array(), 'reverse_dns' => array(), 'fcrdns' => null,
                'provider' => $this->identifyProvider($exchanger['hostname']),
                'reachability' => array('status' => 'NOT_CHECKED', 'detail' => 'Reachability testing was not requested.'),
            ));
            if ($exchanger['hostname'] === '.') {
                $row['reachability'] = array('status' => 'NULL_MX', 'detail' => 'A single "." MX means the domain explicitly accepts no mail.');
                $rows[] = $row;
                continue;
            }
            $a = $this->querySystem($exchanger['hostname'], 'A');
            if ($a['ok']) { $row['ipv4'] = DnsClient::values($a['records'], 'A'); }
            $aaaa = $this->querySystem($exchanger['hostname'], 'AAAA');
            if ($aaaa['ok']) { $row['ipv6'] = DnsClient::values($aaaa['records'], 'AAAA'); }
            $firstAddress = $row['ipv4'] ? $row['ipv4'][0] : ($row['ipv6'] ? $row['ipv6'][0] : '');
            if ($firstAddress !== '') {
                $ptr = $this->querySystem(\CloudHost247\NetworkTools\Dns\ReverseName::forIp($firstAddress), 'PTR');
                if ($ptr['ok']) {
                    $row['reverse_dns'] = DnsClient::values($ptr['records'], 'PTR');
                    $row['fcrdns'] = $row['reverse_dns'] ? in_array(strtolower(rtrim($exchanger['hostname'], '.')), array_map(function ($name) {
                        return strtolower(rtrim($name, '.'));
                    }, $row['reverse_dns']), true) : null;
                }
            }
            if ($checkReachability && $firstAddress !== '') {
                $row['reachability'] = $this->probePort25($firstAddress);
            }
            $rows[] = $row;
        }
        $warnings = array();
        if (!$exchangers) {
            $warnings[] = 'The domain publishes no MX record, so it cannot receive mail at this domain (it may use a subdomain or a mail provider that requires one).';
        }
        if (!$checkReachability && $exchangers) {
            $warnings[] = 'Reachability testing was not requested; no port 25 connection was attempted.';
        }
        return ToolResult::success(array(
            'domain' => $domain,
            'exchange_count' => count($rows),
            'exchangers' => $rows,
            'summary' => $rows ? count($rows) . ' mail exchanger(s), lowest priority: ' . $rows[0]['priority'] : 'No MX records published.',
        ), $warnings, $this->meta($response));
    }

    /** A bounded TCP connection test; a blocked outbound port is reported as such. */
    private function probePort25($address)
    {
        $host = strpos($address, ':') !== false ? '[' . $address . ']' : $address;
        $started = microtime(true);
        $socket = @stream_socket_client('tcp://' . $host . ':25', $errno, $errstr, 4);
        $elapsed = (int) round((microtime(true) - $started) * 1000);
        if (!$socket) {
            $blocked = stripos($errstr, 'timed out') !== false || $errno === 110 || $errno === 60;
            return array(
                'status' => $blocked ? 'UNREACHABLE_OR_BLOCKED' : 'CLOSED',
                'detail' => $blocked
                    ? 'No answer on TCP 25 within 4 seconds. Many hosting providers block outbound port 25, which is reported here rather than being read as a mail-server fault.'
                    : 'The connection to TCP 25 failed: ' . $errstr,
                'latency_ms' => $elapsed,
            );
        }
        $banner = @fgets($socket, 512);
        fclose($socket);
        return array(
            'status' => 'REACHABLE',
            'detail' => $banner !== false && trim((string) $banner) !== '' ? 'Service banner: ' . trim(substr((string) $banner, 0, 120)) : 'The TCP connection was accepted.',
            'latency_ms' => $elapsed,
        );
    }

    private function identifyProvider($hostname)
    {
        $hostname = strtolower(rtrim((string) $hostname, '.'));
        foreach (self::$providers as $suffix => $label) {
            if ($hostname === $suffix || substr($hostname, -strlen($suffix) - 1) === '.' . $suffix) {
                return $label;
            }
        }
        return '';
    }
}
