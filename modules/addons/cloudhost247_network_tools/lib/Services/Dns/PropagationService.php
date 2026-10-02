<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ErrorCode;
use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * DNS Propagation Checker (docs section 4).
 *
 * Queries every enabled resolver in the registry in parallel and classifies
 * each answer against the optional expected value. The wording in the result,
 * the template and the exports is deliberate: this reports what the queried
 * resolvers returned, and nothing about resolvers that were not queried.
 */
final class PropagationService extends Service
{
    const STATUSES = array('PROPAGATED', 'NOT_PROPAGATED', 'MISMATCH', 'TIMEOUT', 'ERROR');

    protected function execute()
    {
        $domain = $this->input['domain'];
        $type = strtoupper($this->input['type']);
        if (!DnsClient::isSupportedType($type) || $type === 'ANY') {
            throw new InvalidArgumentException('That record type is not supported by the propagation checker.');
        }
        $expected = trim((string) (isset($this->input['expected']) ? $this->input['expected'] : ''));
        $mode = isset($this->input['match_mode']) ? $this->input['match_mode'] : 'exact';
        if ($expected !== '' && $mode === 'regex') {
            $delimiter = '#';
            if (@preg_match($delimiter . str_replace($delimiter, '\\' . $delimiter, $expected) . $delimiter . 'i', '') === false) {
                throw new InvalidArgumentException('The expected value is not a usable regular expression.');
            }
        }
        $family = isset($this->input['ip_family']) ? $this->input['ip_family'] : 'all';
        $resolvers = $this->pool()->resolvers($family, array('udp'));
        if (!$resolvers) {
            return ToolResult::configurationRequired('No DNS resolvers are enabled in the resolver registry. An administrator must enable at least one before propagation can be checked.');
        }
        $started = microtime(true);
        $responses = $this->pool()->queryUdpMany($resolvers, $domain, $type);
        $elapsed = (int) round((microtime(true) - $started) * 1000);

        $rows = array();
        $summary = array('PROPAGATED' => 0, 'NOT_PROPAGATED' => 0, 'MISMATCH' => 0, 'TIMEOUT' => 0, 'ERROR' => 0);
        foreach ($responses as $entry) {
            $resolver = $entry['resolver'];
            $response = $entry['response'];
            $values = $response['ok'] ? DnsClient::values($response['records'], $type) : array();
            $status = $this->classify($response, $values, $expected, $mode);
            $summary[$status]++;
            $rows[] = array(
                'resolver_id' => (int) $resolver->id,
                'resolver' => (string) $resolver->name,
                'provider' => (string) $resolver->provider,
                'ip' => (string) $resolver->ip_address,
                'protocol' => (string) $resolver->protocol,
                'version' => (string) $resolver->version,
                'country_code' => (string) $resolver->country_code,
                'region' => (string) $resolver->region,
                'city' => (string) $resolver->city,
                'latitude' => $resolver->latitude !== null ? (float) $resolver->latitude : null,
                'longitude' => $resolver->longitude !== null ? (float) $resolver->longitude : null,
                'values' => $values,
                'value' => $values ? implode(', ', array_slice($values, 0, 4)) : '',
                'status' => $status,
                'status_label' => $this->statusLabel($status),
                'response_time_ms' => (int) $entry['latency_ms'],
                'error' => $response['ok'] ? '' : (string) $response['error'],
                'checked_at' => gmdate('c'),
            );
        }

        $queried = count($rows);
        $data = array(
            'domain' => $domain,
            'type' => $type,
            'expected' => $expected,
            'match_mode' => $mode,
            'resolver_family' => $family,
            'resolvers_queried' => $queried,
            'rows' => $rows,
            'summary_counts' => $summary,
            'elapsed_ms' => $elapsed,
            'summary' => $expected === ''
                ? $queried . ' resolver(s) queried; ' . $summary['PROPAGATED'] . ' returned a record.'
                : $summary['PROPAGATED'] . ' of ' . $queried . ' queried resolver(s) returned the expected value.',
        );
        $warnings = array(
            'This result describes the ' . $queried . ' resolver(s) CloudHost247 queried, not every resolver on the internet.',
            'Resolver and country information describes the anycast point of presence that answered, which is approximate.',
        );
        if ($summary['TIMEOUT'] > 0) {
            $warnings[] = $summary['TIMEOUT'] . ' resolver(s) did not answer within the timeout and are reported as TIMEOUT.';
        }
        if (!$this->pool()->hasResolvers()) {
            $warnings[] = 'No resolvers are enabled in the registry.';
        }
        return ToolResult::success($data, $warnings, array('elapsed_ms' => $elapsed, 'resolvers_queried' => $queried));
    }

    private function classify(array $response, array $values, $expected, $mode)
    {
        if (!$response['ok']) {
            if ($response['code'] === ErrorCode::TIMEOUT) {
                return 'TIMEOUT';
            }
            return 'ERROR';
        }
        if (!$values) {
            return 'NOT_PROPAGATED';
        }
        if ($expected === '') {
            return 'PROPAGATED';
        }
        foreach ($values as $value) {
            if ($this->matches($value, $expected, $mode)) {
                return 'PROPAGATED';
            }
        }
        return 'MISMATCH';
    }

    private function matches($value, $expected, $mode)
    {
        $value = trim((string) $value);
        $expected = trim((string) $expected);
        if ($mode === 'contains') {
            return stripos($value, $expected) !== false;
        }
        if ($mode === 'regex') {
            $delimiter = '#';
            return @preg_match($delimiter . str_replace($delimiter, '\\' . $delimiter, $expected) . $delimiter . 'i', $value) === 1;
        }
        // For IPs compare the packed form, so "2001:db8::1" and
        // "2001:0db8:0:0:0:0:0:1" are correctly equal; for everything else
        // compare case-insensitively with the quotes TXT records carry.
        if (filter_var($value, FILTER_VALIDATE_IP) !== false && filter_var($expected, FILTER_VALIDATE_IP) !== false) {
            return @inet_pton($value) === @inet_pton($expected);
        }
        return strcasecmp(trim($value, '"'), trim($expected, '"')) === 0;
    }

    private function statusLabel($status)
    {
        $labels = array(
            'PROPAGATED' => 'Propagated',
            'NOT_PROPAGATED' => 'Not propagated',
            'MISMATCH' => 'Mismatch',
            'TIMEOUT' => 'Timeout',
            'ERROR' => 'Error',
        );
        return isset($labels[$status]) ? $labels[$status] : $status;
    }
}
