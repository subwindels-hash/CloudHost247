<?php
namespace CloudHost247\NetworkTools\Services\Ip;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;

/** Domain to IP (docs section 19): follows the CNAME chain, reports every answer. */
final class DomainIpService extends Service
{
    protected function execute()
    {
        $domain = $this->input['domain'];
        $pool = $this->pool();
        $client = $pool->defaultClient();
        $chain = array();
        $records = array();
        $warnings = array();
        $current = $domain;
        foreach (array('A', 'AAAA') as $type) {
            $resolved = $pool->resolveChain($current, $type, $client);
            if (!empty($resolved['chain'])) {
                $chain = $resolved['chain'];
            }
            if ($resolved['error'] !== '' && $resolved['error'] !== 'No ' . $type . ' record was returned.') {
                $warnings[] = $type . ': ' . $resolved['error'];
            }
            foreach ((array) $resolved['response']['records'] as $record) {
                if ($record['type'] !== $type) {
                    continue;
                }
                $records[] = array(
                    'type' => $record['type'],
                    'name' => $record['name'],
                    'value' => $record['value'],
                    'ttl' => isset($record['ttl']) ? (int) $record['ttl'] : null,
                    'resolver' => $client->resolverLabel(),
                    'response_time_ms' => isset($resolved['response']['latency_ms']) ? (int) $resolved['response']['latency_ms'] : null,
                );
            }
        }
        $ipv4 = array();
        $ipv6 = array();
        foreach ($records as $record) {
            if ($record['type'] === 'A') { $ipv4[] = $record['value']; }
            if ($record['type'] === 'AAAA') { $ipv6[] = $record['value']; }
        }
        if (!$ipv4 && !$ipv6) {
            return ToolResult::failure('DOMAIN_NOT_FOUND', 'No A or AAAA record was returned for ' . $domain . ', so it does not currently resolve to an address.', array('chain' => $chain, 'resolver' => $client->resolverLabel()), $warnings);
        }
        return ToolResult::success(array(
            'domain' => $domain,
            'ipv4' => $ipv4,
            'ipv6' => $ipv6,
            'cname_chain' => $chain,
            'records' => $records,
            'resolver' => $client->resolverLabel(),
            'summary' => $domain . ' resolves to ' . implode(', ', array_merge($ipv4, $ipv6)) . '.',
            'explanation' => 'A domain may publish several addresses; which one a visitor gets depends on the resolver and the provider\'s routing (round robin, anycast or geo-DNS).',
        ), $warnings, $this->meta(array('resolver' => $client->resolverLabel())));
    }
}
