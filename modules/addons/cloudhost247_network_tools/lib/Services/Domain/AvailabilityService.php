<?php
namespace CloudHost247\NetworkTools\Services\Domain;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Domain availability (docs section 39).
 *
 * The answer comes from the registrar the platform is already configured with,
 * at the moment of the request. Nothing here guesses: when no registrar is
 * configured the tool returns CONFIGURATION_REQUIRED, when the registrar does
 * not support the TLD it says UNSUPPORTED, and an unknown response stays
 * UNKNOWN with the registrar's own text quoted.
 */
final class AvailabilityService extends Service
{
    protected function execute()
    {
        $domain = TargetValidator::domain($this->input['domain']);
        $bridge = $this->provider();
        $candidates = array('godaddy', 'gandi');
        $readiness = $bridge->firstAvailable($candidates);
        if (!$readiness['available']) {
            return ToolResult::configurationRequired('No domain registrar integration is configured in CloudHost247 (Admin → API & Integrations → Domains). Availability cannot be checked without one.');
        }
        $providerKey = $readiness['key'];
        if ($providerKey === 'godaddy') {
            return $this->godaddy($bridge, $domain);
        }
        return $this->gandi($bridge, $domain);
    }

    private function godaddy($bridge, $domain)
    {
        $response = $bridge->call('godaddy', 'GET', '/v1/domains/available', array(
            'query' => array('domain' => $domain, 'checkType' => 'FULL'),
        ));
        if (!$response['ok']) {
            return ToolResult::failure($response['code'], $response['message'] . ' (registrar: GoDaddy)');
        }
        $json = is_array($response['json']) ? $response['json'] : array();
        $available = isset($json['available']) ? (bool) $json['available'] : null;
        $status = $available === null ? 'UNKNOWN' : ($available ? 'AVAILABLE' : 'REGISTERED');
        $warnings = array();
        if ($status === 'REGISTERED') {
            $warnings[] = 'The registrar reports the name as taken. Ownership, expiry and transfer eligibility are shown by the WHOIS tool for names in public registries.';
        }
        return ToolResult::success(array(
            'domain' => $domain,
            'status' => $status,
            'available' => $available,
            'registrar' => 'GoDaddy',
            'premium' => isset($json['definitive']) ? !$json['definitive'] : null,
            'price' => isset($json['price']) ? array('amount' => $json['price'] / 1000000, 'currency' => isset($json['currency']) ? $json['currency'] : 'USD', 'note' => 'Registrar list price in the account currency; taxes and premium tiers may differ.') : null,
            'period_years' => isset($json['period']) ? (int) $json['period'] : null,
            'registrar_message' => isset($json['message']) ? (string) $json['message'] : '',
            'checked_at' => gmdate('c'),
            'registrar_notice' => 'This is the registrar\'s own answer at the moment of the query. Availability can change before a registration completes, and the registration itself is the only confirmation.',
            'summary' => $domain . ' is reported as ' . strtolower(str_replace('_', ' ', $status)) . ' by GoDaddy.',
        ), $warnings, array('latency_ms' => $response['latency_ms']));
    }

    private function gandi($bridge, $domain)
    {
        $response = $bridge->call('gandi', 'GET', '/v5/domain/check', array('query' => array('name' => array($domain))));
        if (!$response['ok']) {
            return ToolResult::failure($response['code'], $response['message'] . ' (registrar: Gandi)');
        }
        $json = is_array($response['json']) ? $response['json'] : array();
        $entry = isset($json['products'][0]) ? $json['products'][0] : array();
        $statusCode = isset($entry['status']) ? strtolower((string) $entry['status']) : '';
        $map = array(
            'available' => 'AVAILABLE',
            'pending' => 'PENDING',
            'invalid' => 'UNSUPPORTED',
            'unavailable' => 'REGISTERED',
            'error' => 'UNKNOWN',
        );
        $status = isset($map[$statusCode]) ? $map[$statusCode] : 'UNKNOWN';
        $warnings = array();
        if ($status === 'UNKNOWN') {
            $warnings[] = 'The registrar returned a status this tool does not recognise; the raw status is quoted instead of being interpreted.';
        }
        if ($status === 'UNSUPPORTED') {
            $warnings[] = 'The registrar does not support this TLD, so availability could not be determined. This does not mean the domain is free.';
        }
        return ToolResult::success(array(
            'domain' => $domain,
            'status' => $status,
            'available' => $status === 'AVAILABLE',
            'registrar' => 'Gandi',
            'registrar_status' => $statusCode,
            'price' => isset($entry['price']) ? $entry['price'] : null,
            'checked_at' => gmdate('c'),
            'registrar_notice' => 'This is the registrar\'s own answer at the moment of the query. Availability can change before a registration completes.',
            'summary' => $domain . ' is reported as ' . strtolower(str_replace('_', ' ', $status)) . ' by Gandi.',
        ), $warnings, array('latency_ms' => $response['latency_ms']));
    }
}
