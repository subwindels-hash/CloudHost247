<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Dns\ReverseName;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Reverse DNS (docs sections 14, 20) and reverse IP (section 15).
 *
 * A PTR answer is reported exactly as published. Forward confirmation (FCrDNS)
 * is a separate, explicit check: it re-resolves the returned name and compares
 * the addresses, so "confirmed" is evidence rather than an assumption.
 */
final class ReverseService extends Service
{
    public function ptr(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    public function reverseIp(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    protected function execute()
    {
        $tool = $this->tool();
        $ip = $this->input['ip'];
        $reverseName = ReverseName::forIp($ip);
        if ($reverseName === null) {
            return ToolResult::invalid('That is not a valid IP address.');
        }
        $client = $this->pool()->defaultClient();
        $response = $client->query($reverseName, 'PTR');
        $hostnames = array();
        if ($response['ok']) {
            $hostnames = DnsClient::values($response['records'], 'PTR');
        }
        $forwardConfirmed = null;
        $forwardAddresses = array();
        $warnings = array();
        if ($hostnames && $tool !== null && $tool->slug() === 'dns/reverse' && !empty($this->input['confirm_forward'])) {
            $forward = $this->querySystem($hostnames[0], strpos($ip, ':') !== false ? 'AAAA' : 'A');
            if ($forward['ok']) {
                $forwardAddresses = DnsClient::values($forward['records'], strpos($ip, ':') !== false ? 'AAAA' : 'A');
            }
            $forwardConfirmed = in_array($ip, $forwardAddresses, true);
            if ($forwardConfirmed === false && $forwardAddresses) {
                $warnings[] = 'The PTR name resolves to different addresses (' . implode(', ', array_slice($forwardAddresses, 0, 4)) . '), so forward-confirmed reverse DNS does not match.';
            }
        }
        if (!$hostnames && $response['ok']) {
            $warnings[] = 'No PTR record is published for this address. That is normal for many consumer and cloud ranges.';
        }
        if (!$response['ok'] && $response['code'] !== 'DOMAIN_NOT_FOUND') {
            return $this->dnsFailure($response, 'The reverse lookup failed');
        }

        $data = array(
            'ip' => $ip,
            'reverse_name' => $reverseName,
            'ptr_records' => $hostnames,
            'hostname' => $hostnames ? $hostnames[0] : '',
            'forward_confirmed' => $forwardConfirmed,
            'forward_addresses' => $forwardAddresses,
            'summary' => $hostnames ? 'PTR: ' . implode(', ', array_slice($hostnames, 0, 3)) : 'No PTR record published.',
        );

        if ($tool !== null && $tool->slug() === 'dns/reverse-ip') {
            // Only sources that legitimately publish observations may answer
            // this. No provider configured means no answer, never a guess.
            $bridge = $this->provider();
            $providerKeys = $tool->providers();
            $readiness = $bridge->firstAvailable($providerKeys);
            $data['sources'] = array(array('source' => 'Reverse DNS (PTR)', 'hostnames' => $hostnames));
            if ($readiness['available']) {
                $lookup = $bridge->call($readiness['key'], 'GET', '/lookup/' . rawurlencode($ip), array('query' => array()));
                if ($lookup['ok'] && is_array($lookup['json'])) {
                    $data['sources'][] = array('source' => $readiness['key'], 'hostnames' => $this->extractDomains($lookup['json']));
                } else {
                    $warnings[] = 'The configured reverse-IP provider did not return data for this address (' . $lookup['message'] . ').';
                }
            } else {
                $warnings[] = 'No passive-DNS provider is configured, so only the PTR record could be reported. Reverse IP can never list every domain on an address: it can only show what a supported source has observed.';
            }
        }
        return ToolResult::success($data, $warnings, $this->meta($response));
    }

    /** Pull hostnames out of a provider payload without inventing any. */
    private function extractDomains(array $payload)
    {
        $found = array();
        $walk = function ($value, $key = '') use (&$walk, &$found) {
            if (is_array($value)) {
                foreach ($value as $childKey => $child) {
                    $walk($child, is_string($childKey) ? $childKey : $key);
                }
                return;
            }
            if (is_string($value) && preg_match('/^([a-z0-9_-]+\.)+[a-z]{2,}$/i', $value)) {
                $found[] = strtolower($value);
            }
        };
        $walk($payload);
        return array_values(array_unique($found));
    }
}
