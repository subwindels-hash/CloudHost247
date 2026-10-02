<?php
namespace CloudHost247\NetworkTools\Services\Ip;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Dns\ReverseName;
use CloudHost247\NetworkTools\Services\Service;

/**
 * IP intelligence (docs sections 16, 18, 51).
 *
 * Local facts are always produced (family, reverse DNS, private-range status,
 * the CloudHost247 customer's own services where the IP belongs to them).
 * Geolocation, ISP and ASN come from the provider configured in API &
 * Integrations; when none is configured those fields are reported as
 * CONFIGURATION_REQUIRED inside the result rather than filled with guesses.
 */
final class LookupService extends Service
{
    /** Provider payload keys mapped onto our documented field names. */
    private static $fieldMap = array(
        'city' => array('city'), 'region' => array('region', 'region_name', 'state_province'),
        'country' => array('country_name', 'country'), 'country_code' => array('country_code', 'country'),
        'postal' => array('postal', 'zip', 'postal_code'), 'latitude' => array('latitude', 'lat'),
        'longitude' => array('longitude', 'lon', 'lng'), 'timezone' => array('timezone', 'time_zone'),
        'asn' => array('asn', 'as', 'org_asn'), 'organization' => array('org', 'organization', 'organisation'),
        'isp' => array('isp', 'org', 'carrier'), 'connection_type' => array('connection_type', 'usage_type', 'type'),
        'hostname' => array('hostname'), 'network' => array('network', 'route', 'cidr'),
    );

    public function lookup(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    public function isp(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    public function myIp(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    protected function execute()
    {
        $slug = $this->tool() ? $this->tool()->slug() : 'ip/lookup';
        if ($slug === 'ip/my-ip') {
            return $this->respondMyIp();
        }
        $ip = $this->input['ip'];
        $packed = IpMath::packed($ip);
        $family = strlen($packed) === 4 ? 'IPv4' : 'IPv6';
        $private = !\CloudHost247\NetworkTools\Core\Security\SsrfGuard::isAllowedAddress($ip);
        $reverse = $this->reverseDns($ip);
        $data = array(
            'ip' => $ip,
            'version' => $family,
            'private_range' => $private,
            'reverse_dns' => $reverse,
            'hostname' => $reverse ? $reverse[0] : '',
            'whois_available' => true,
            'facts_source' => 'CloudHost247',
            'summary' => $ip . ' (' . $family . ($private ? ', private or reserved range' : '') . ')',
        );
        $warnings = array();
        if ($private) {
            $warnings[] = 'This address is in a private, loopback, link-local or reserved range, so no registry or geolocation data exists for it.';
        }
        $providerData = $this->providerFacts($ip, $warnings);
        $data = array_merge($data, $providerData);
        $data['approximate_location_notice'] = 'Geolocation describes where the network operator registers this address block (or the nearest anycast point of presence). It is approximate and is never evidence of a person\'s physical location.';
        if ($slug === 'ip/isp') {
            $data['isp_summary'] = array(
                'isp' => isset($data['isp']) ? $data['isp'] : '',
                'organization' => isset($data['organization']) ? $data['organization'] : '',
                'asn' => isset($data['asn']) ? $data['asn'] : '',
                'connection_type' => isset($data['connection_type']) ? $data['connection_type'] : '',
                'registry' => isset($data['registry']) ? $data['registry'] : '',
            );
        }
        return ToolResult::success($data, $warnings, array('lookup_at' => gmdate('c')));
    }

    private function respondMyIp()
    {
        $ip = isset($this->context['ip']) ? (string) $this->context['ip'] : '';
        $packed = IpMath::packed($ip);
        $userAgent = isset($_SERVER['HTTP_USER_AGENT']) ? substr((string) $_SERVER['HTTP_USER_AGENT'], 0, 512) : '';
        $data = array(
            'ip' => $packed !== null ? inet_ntop($packed) : $ip,
            'version' => $packed !== null ? (strlen($packed) === 4 ? 'IPv4' : 'IPv6') : 'unknown',
            'ipv4' => $packed !== null && strlen($packed) === 4 ? inet_ntop($packed) : null,
            'ipv6' => $packed !== null && strlen($packed) === 16 ? inet_ntop($packed) : null,
            'server_sees' => $packed !== null ? 'The CloudHost247 web server received this request from the address shown.' : 'The server could not determine a valid remote address for this request.',
            'user_agent' => $userAgent,
            'accept_language' => isset($_SERVER['HTTP_ACCEPT_LANGUAGE']) ? substr((string) $_SERVER['HTTP_ACCEPT_LANGUAGE'], 0, 128) : '',
            'request_time' => gmdate('c'),
            'proxy_disclosure' => 'If a reverse proxy or CDN is in front of this site, the address shown is the one the proxy forwarded; CloudHost247 only trusts forwarded headers when an administrator enables that explicitly.',
            'privacy' => 'Nothing in this result is stored beyond the module\'s normal metadata history, and no third-party service was contacted to produce it.',
        );
        return ToolResult::success($data, array(), array('local_only' => true));
    }

    private function reverseDns($ip)
    {
        $name = ReverseName::forIp($ip);
        if ($name === null) {
            return array();
        }
        $response = $this->querySystem($name, 'PTR');
        if (!$response['ok']) {
            return array();
        }
        return DnsClient::values($response['records'], 'PTR');
    }

    private function providerFacts($ip, array &$warnings)
    {
        $bridge = $this->provider();
        $keys = $this->tool() ? $this->tool()->providers() : array('ipinfo', 'ipwhoapi');
        $readiness = $bridge->firstAvailable($keys);
        if (!$readiness['available']) {
            $warnings[] = 'No geolocation/ASN provider is configured in API & Integrations, so location, ISP and ASN fields are reported as CONFIGURATION_REQUIRED. Enable a provider to populate them.';
            return array(
                'location' => null, 'provider' => '', 'provider_status' => 'CONFIGURATION_REQUIRED',
                'city' => '', 'region' => '', 'country' => '', 'country_code' => '', 'timezone' => '',
                'latitude' => null, 'longitude' => null, 'asn' => '', 'organization' => '', 'isp' => '',
                'connection_type' => '', 'network' => '', 'registry' => '',
            );
        }
        $call = $bridge->call($readiness['key'], 'GET', '/lookup/' . rawurlencode($ip));
        if (!$call['ok'] || !is_array($call['json'])) {
            $warnings[] = 'The configured provider (' . $readiness['key'] . ') did not return data for this address: ' . $call['message'];
            return array(
                'location' => null, 'provider' => $readiness['key'], 'provider_status' => 'PROVIDER_ERROR',
                'city' => '', 'region' => '', 'country' => '', 'country_code' => '', 'timezone' => '',
                'latitude' => null, 'longitude' => null, 'asn' => '', 'organization' => '', 'isp' => '',
                'connection_type' => '', 'network' => '', 'registry' => '',
            );
        }
        $payload = $call['json'];
        $facts = array('location' => $payload, 'provider' => $readiness['key'], 'provider_status' => 'OK', 'registry' => '');
        foreach (self::$fieldMap as $field => $candidates) {
            $facts[$field] = '';
            foreach ($candidates as $candidate) {
                if (isset($payload[$candidate]) && is_scalar($payload[$candidate]) && (string) $payload[$candidate] !== '') {
                    $facts[$field] = (string) $payload[$candidate];
                    break;
                }
            }
        }
        foreach (array('latitude', 'longitude') as $coordinate) {
            $facts[$coordinate] = $facts[$coordinate] !== '' && is_numeric($facts[$coordinate]) ? (float) $facts[$coordinate] : null;
        }
        if ($facts['country'] === '' && $facts['country_code'] !== '') {
            $facts['country'] = $facts['country_code'];
        }
        if ($facts['asn'] !== '' && stripos($facts['asn'], 'AS') !== 0) {
            $facts['asn'] = 'AS' . $facts['asn'];
        }
        $facts['provider_latency_ms'] = $call['latency_ms'];
        $facts['provider_fields'] = array_keys($payload);
        return $facts;
    }
}
