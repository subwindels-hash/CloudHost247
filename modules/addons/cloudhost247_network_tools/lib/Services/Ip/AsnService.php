<?php
namespace CloudHost247\NetworkTools\Services\Ip;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * ASN lookup (docs section 29).
 *
 * ASN data comes from the configured provider. When none is configured the
 * service says CONFIGURATION_REQUIRED — an ASN record cannot be derived from
 * DNS or from an IP address locally, so there is nothing honest to show.
 */
final class AsnService extends Service
{
    protected function execute()
    {
        $asn = preg_replace('/^AS/', '', $this->input['asn']);
        $bridge = $this->provider();
        $keys = $this->tool() ? $this->tool()->providers() : array('ipinfo', 'ipwhoapi');
        $readiness = $bridge->firstAvailable($keys);
        if (!$readiness['available']) {
            return ToolResult::configurationRequired('No ASN provider is configured. Add IP intelligence credentials in Admin → CloudHost247 API & Integrations, then try again.');
        }
        $call = $bridge->call($readiness['key'], 'GET', '/asn/AS' . $asn);
        if (!$call['ok'] || !is_array($call['json'])) {
            return ToolResult::failure('PROVIDER_ERROR', 'The configured provider could not answer for AS' . $asn . ': ' . $call['message'], array('provider' => $readiness['key']));
        }
        $payload = $call['json'];
        $pick = function (array $keys, array $payload) {
            foreach ($keys as $key) {
                if (isset($payload[$key]) && is_scalar($payload[$key]) && (string) $payload[$key] !== '') {
                    return (string) $payload[$key];
                }
            }
            return '';
        };
        $prefixes = array();
        foreach (array('prefixes', 'routes', 'announced_prefixes') as $key) {
            if (isset($payload[$key]) && is_array($payload[$key])) {
                foreach ($payload[$key] as $prefix) {
                    if (is_string($prefix)) { $prefixes[] = $prefix; }
                    elseif (is_array($prefix)) {
                        $candidate = $pick(array('prefix', 'route', 'cidr'), $prefix);
                        if ($candidate !== '') { $prefixes[] = $candidate; }
                    }
                }
                break;
            }
        }
        return ToolResult::success(array(
            'asn' => 'AS' . $asn,
            'organization' => $pick(array('name', 'org', 'organization', 'as_name'), $payload),
            'country' => $pick(array('country', 'country_code'), $payload),
            'registry' => $pick(array('registry', 'rir', 'source'), $payload),
            'type' => $pick(array('type', 'asn_type'), $payload),
            'allocated' => $pick(array('allocated', 'date_allocated', 'created'), $payload),
            'prefixes' => array_slice(array_values(array_unique($prefixes)), 0, 200),
            'prefix_count' => count(array_unique($prefixes)),
            'provider' => $readiness['key'],
            'provider_latency_ms' => $call['latency_ms'],
            'summary' => 'AS' . $asn . ' · ' . $pick(array('name', 'org', 'organization'), $payload),
            'explanation' => 'An autonomous system is a network under one routing policy. Prefix lists change constantly and are shown only as far as the provider publishes them.',
        ), $prefixes ? array() : array('The provider did not return prefix information for this ASN, so only the registry record is shown.'));
    }
}
