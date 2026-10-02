<?php
namespace CloudHost247\NetworkTools\Services\Ip;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;
use CloudHost247\NetworkTools\Services\Shared\WhoisClient;

/**
 * IP WHOIS (docs section 18).
 *
 * Queries the registry over TCP 43 through the shared WHOIS client, and parses
 * the published objects into fields. When the hosting network blocks port 43 the
 * result says exactly that instead of returning partial fiction. A WHOIS API
 * provider can be configured; it is used only when TCP 43 is unavailable.
 */
final class WhoisService extends Service
{
    protected function execute()
    {
        $ip = $this->input['ip'];
        $packed = IpMath::packed($ip);
        if ($packed === null) {
            return ToolResult::invalid('Enter a valid IPv4 or IPv6 address.');
        }
        if (!\CloudHost247\NetworkTools\Core\Security\SsrfGuard::isAllowedAddress($ip)) {
            return ToolResult::blocked('Private, loopback and reserved addresses have no registry object, so no WHOIS query was made.');
        }
        $client = new WhoisClient();
        $lookup = $client->queryIp($ip);
        $warnings = array();
        if (!$lookup['ok']) {
            $bridge = $this->provider();
            $readiness = $bridge->firstAvailable($this->tool() ? $this->tool()->providers() : array('whois'));
            if ($readiness['available']) {
                $call = $bridge->call($readiness['key'], 'GET', '/ip/' . rawurlencode($ip));
                if ($call['ok'] && is_array($call['json'])) {
                    return ToolResult::success(array(
                        'ip' => $ip,
                        'source' => 'api:' . $readiness['key'],
                        'fields' => $call['json'],
                        'summary' => 'WHOIS data for ' . $ip . ' retrieved through the configured API provider.',
                    ), array('TCP WHOIS port 43 was unavailable (' . $lookup['error'] . '), so the configured API provider was used instead.'));
                }
            }
            return ToolResult::failure('PROVIDER_ERROR', $lookup['error'], array('queried_server' => $lookup['server']));
        }
        $fields = WhoisClient::parse($lookup['text']);
        unset($fields['refer']);
        $interesting = array(
            'NetRange' => 'network_range', 'CIDR' => 'cidr', 'NetName' => 'network_name', 'OrgName' => 'organization',
            'OrgId' => 'organization_id', 'Country' => 'country', 'RegDate' => 'registered', 'Updated' => 'updated',
            'descr' => 'description', 'org-name' => 'organization', 'netname' => 'network_name', 'country' => 'country',
            'route' => 'route', 'origin' => 'origin', 'inetnum' => 'network_range', 'inet6num' => 'network_range',
            'abuse-mailbox' => 'abuse_contact', 'OrgAbuseEmail' => 'abuse_contact', 'e-mail' => 'email',
        );
        $parsed = array();
        foreach ($interesting as $key => $label) {
            $lower = strtolower($key);
            if (isset($fields[$lower]) && (string) $fields[$lower] !== '') {
                $parsed[$label] = (string) $fields[$lower];
            }
        }
        if (isset($fields['orgabuseemail'])) {
            $parsed['abuse_contact'] = $fields['orgabuseemail'];
        }
        return ToolResult::success(array(
            'ip' => $ip,
            'source' => 'whois:tcp',
            'queried_server' => $lookup['server'],
            'referrals' => $lookup['referrals'],
            'fields' => $fields,
            'parsed' => $parsed,
            'raw_text' => substr($lookup['text'], 0, 20000),
            'latency_ms' => isset($lookup['latency_ms']) ? (int) $lookup['latency_ms'] : null,
            'summary' => isset($parsed['network_name']) ? $parsed['network_name'] : 'WHOIS record retrieved from ' . $lookup['server'] . '.',
            'explanation' => 'WHOIS reflects the registry object that holds this address block. Fields the registry does not publish are not shown.',
        ), $warnings);
    }
}
