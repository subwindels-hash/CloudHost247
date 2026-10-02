<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;

/**
 * DNSKEY and DS lookups with real chain evidence (docs sections 12, 13).
 *
 * Rather than declaring a zone "secure" because DS records exist, the service
 * computes the DS digest from each published DNSKEY and compares it with the
 * DS records the parent actually returns, and asks a validating resolver
 * whether it sets the AD bit for the zone's A record.
 */
final class DnssecService extends Service
{
    const ALGORITHMS = array(1 => 'RSAMD5 (deprecated)', 3 => 'DSA', 5 => 'RSASHA1', 6 => 'DSA-NSEC3-SHA1', 7 => 'RSASHA1-NSEC3-SHA1', 8 => 'RSASHA256', 10 => 'RSASHA512', 13 => 'ECDSAP256SHA256', 14 => 'ECDSAP384SHA384', 15 => 'ED25519', 16 => 'ED448');
    const DIGESTS = array(1 => 'SHA-1', 2 => 'SHA-256', 4 => 'SHA-384');

    public function dnskey(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    public function ds(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    protected function execute()
    {
        $slug = $this->tool() ? $this->tool()->slug() : 'dns/dnskey';
        $domain = $this->input['domain'];
        $zone = $domain;
        $keyResponse = $this->querySystem($zone, 'DNSKEY');
        $keys = array();
        if ($keyResponse['ok']) {
            foreach ($keyResponse['records'] as $record) {
                if ($record['type'] !== 'DNSKEY') { continue; }
                $flags = isset($record['flags']) ? (int) $record['flags'] : 0;
                $keys[] = array(
                    'key_tag' => isset($record['key_tag']) ? (int) $record['key_tag'] : null,
                    'algorithm' => isset($record['algorithm']) ? (int) $record['algorithm'] : null,
                    'algorithm_name' => isset(self::ALGORITHMS[(int) $record['algorithm']]) ? self::ALGORITHMS[(int) $record['algorithm']] : 'Unknown algorithm',
                    'flags' => $flags,
                    'role' => ($flags & 1) === 1 ? 'KSK (key signing key)' : 'ZSK (zone signing key)',
                    'protocol' => isset($record['protocol']) ? (int) $record['protocol'] : null,
                    'public_key' => isset($record['public_key']) ? $record['public_key'] : '',
                    'ttl' => isset($record['ttl']) ? (int) $record['ttl'] : null,
                    'raw' => $record['raw'],
                );
            }
        }
        // The parent zone is the name one label shorter; for a second-level
        // domain that is the TLD, whose DS records are authoritative there.
        $parent = substr($zone, strpos($zone, '.') + 1);
        $dsResponse = $this->querySystem($zone, 'DS');
        $dsRecords = array();
        if ($dsResponse['ok']) {
            foreach ($dsResponse['records'] as $record) {
                if ($record['type'] !== 'DS') { continue; }
                $dsRecords[] = array(
                    'key_tag' => isset($record['key_tag']) ? (int) $record['key_tag'] : null,
                    'algorithm' => isset($record['algorithm']) ? (int) $record['algorithm'] : null,
                    'algorithm_name' => isset(self::ALGORITHMS[(int) $record['algorithm']]) ? self::ALGORITHMS[(int) $record['algorithm']] : 'Unknown algorithm',
                    'digest_type' => isset($record['digest_type']) ? (int) $record['digest_type'] : null,
                    'digest_type_name' => isset(self::DIGESTS[(int) $record['digest_type']]) ? self::DIGESTS[(int) $record['digest_type']] : 'Unknown digest',
                    'digest' => isset($record['digest']) ? $record['digest'] : '',
                    'ttl' => isset($record['ttl']) ? (int) $record['ttl'] : null,
                    'parent_zone' => $parent,
                );
            }
        }
        // Chain evidence: recompute each DS digest from the DNSKEY set.
        $matches = array();
        foreach ($dsRecords as $ds) {
            $matchedKey = null;
            foreach ($keys as $key) {
                if ($key['key_tag'] !== $ds['key_tag']) { continue; }
                $computed = $this->dsDigest($zone, $ds['digest_type'], $key['raw']);
                if ($computed !== null && strcasecmp($computed, $ds['digest']) === 0) {
                    $matchedKey = $key['key_tag'];
                    break;
                }
            }
            $matches[] = array('ds' => $ds, 'matched_key_tag' => $matchedKey, 'verified' => $matchedKey !== null);
        }
        $adEvidence = $this->validationEvidence($zone);
        if ($slug === 'dns/ds') {
            if (!$dsRecords && !$keys) {
                return ToolResult::success(array(
                    'domain' => $zone, 'parent_zone' => $parent, 'ds_records' => array(), 'dnskey_records' => array(),
                    'dnssec_enabled' => false, 'chain_complete' => false, 'validating_resolver_evidence' => $adEvidence,
                    'summary' => 'DNSSEC is not enabled for this zone.',
                    'explanation' => 'No DS record is published at the parent and no DNSKEY is published at the zone, so there is nothing to validate.',
                ), array(), $this->meta($keyResponse));
            }
            return ToolResult::success(array(
                'domain' => $zone,
                'parent_zone' => $parent,
                'ds_records' => $dsRecords,
                'dnskey_records' => $keys,
                'digest_comparison' => $matches,
                'chain_complete' => $this->chainComplete($matches, $keys),
                'validating_resolver_evidence' => $adEvidence,
                'summary' => $dsRecords ? count($dsRecords) . ' DS record(s) published at ' . $parent . '.' : 'No DS record at the parent: the zone is not signed for validating resolvers.',
                'explanation' => 'A DS record publishes a hash of the child zone\'s key-signing key. The comparison above recomputes each digest from the DNSKEY data returned for the zone.',
            ), $this->chainWarnings($matches, $keys), $this->meta($keyResponse));
        }
        return ToolResult::success(array(
            'domain' => $zone,
            'dnskey_records' => $keys,
            'ds_records' => $dsRecords,
            'digest_comparison' => $matches,
            'dnssec_enabled' => count($keys) > 0,
            'chain_complete' => $this->chainComplete($matches, $keys),
            'validating_resolver_evidence' => $adEvidence,
            'summary' => $keys ? count($keys) . ' DNSKEY record(s) published.' : 'No DNSKEY record published: the zone is not DNSSEC signed.',
            'explanation' => 'Flags 256 marks a zone-signing key, 257 a key-signing key. Publishing keys alone does not create a chain of trust: the DS record at the parent must match one of them.',
        ), $this->chainWarnings($matches, $keys), $this->meta($keyResponse));
    }

    private function chainComplete(array $matches, array $keys)
    {
        if (!$keys || !$matches) {
            return false;
        }
        foreach ($matches as $match) {
            if ($match['verified']) {
                return true;
            }
        }
        return false;
    }

    private function chainWarnings(array $matches, array $keys)
    {
        $warnings = array();
        if ($keys && !$matches) {
            $warnings[] = 'The zone publishes keys but no DS record was returned for the zone name, so validating resolvers have no entry point.';
        }
        foreach ($matches as $match) {
            if (!$match['verified']) {
                $warnings[] = 'DS record with key tag ' . $match['ds']['key_tag'] . ' does not match any published DNSKEY digest: validating resolvers would treat the zone as bogus.';
            }
        }
        return $warnings;
    }

    /**
     * Recompute the DS digest (RFC 4034 §5.1.4) over the DNSKEY owner name,
     * flags/protocol/algorithm and public key.
     */
    private function dsDigest($zone, $digestType, $keyRaw)
    {
        $algorithm = array(1 => 'sha1', 2 => 'sha256', 4 => 'sha384');
        if (!isset($algorithm[(int) $digestType])) {
            return null;
        }
        $owner = '';
        foreach (explode('.', rtrim($zone, '.')) as $label) {
            $owner .= chr(strlen($label)) . strtolower($label);
        }
        $owner .= "\x00";
        $binary = @hex2bin($keyRaw);
        if ($binary === false) {
            return null;
        }
        return strtoupper(hash($algorithm[(int) $digestType], $owner . $binary));
    }

    /** Ask a validating resolver whether it authenticated the zone's A record. */
    private function validationEvidence($zone)
    {
        $pool = $this->pool();
        $resolvers = $pool->resolvers('all', array('udp'), 2);
        $evidence = array();
        foreach ($resolvers as $row) {
            $response = $pool->clientFor($row)->query($zone, 'A');
            if (!$response['ok']) {
                continue;
            }
            $evidence[] = array(
                'resolver' => (string) $row->name,
                'ip' => (string) $row->ip_address,
                'authenticated_data' => !empty($response['authenticated']),
                'note' => !empty($response['authenticated'])
                    ? 'This resolver set the AD flag, which means it validated the answer using DNSSEC.'
                    : 'This resolver did not set the AD flag for the answer, so it either did not validate or the zone is not signed.',
            );
        }
        return $evidence;
    }
}
