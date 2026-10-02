<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;

/**
 * SPF Checker (docs section 8).
 *
 * Validates syntax, detects the two classic configuration faults (more than one
 * SPF record, more than ten DNS-lookup mechanisms), expands include/redirect
 * chains with a bounded recursion and reports every mechanism with its meaning.
 */
final class SpfService extends Service
{
    const LOOKUP_MECHANISMS = array('include', 'a', 'mx', 'ptr', 'exists', 'redirect');
    const MAX_LOOKUPS = 10;
    const MAX_DEPTH = 6;

    protected function execute()
    {
        $domain = $this->input['domain'];
        $response = $this->querySystem($domain, 'TXT');
        if (!$response['ok'] && (int) $response['rcode'] !== 3) {
            return $this->dnsFailure($response, 'The SPF lookup failed');
        }
        $spfRecords = array();
        $allTxt = array();
        foreach ($response['records'] as $record) {
            if ($record['type'] !== 'TXT') {
                continue;
            }
            $value = (string) $record['value'];
            $allTxt[] = $value;
            if (stripos(trim($value), 'v=spf1') === 0) {
                $spfRecords[] = trim($value);
            }
        }
        $checks = array();
        if (!$spfRecords) {
            $checks[] = $this->check('spf_present', 'SPF record present', 'ERROR', 'No TXT record beginning with v=spf1 was found for ' . $domain . '.');
            $explanation = 'Without an SPF record, receivers have no authorised sender list and cannot use SPF in their DMARC decision.';
            return ToolResult::success(array(
                'domain' => $domain, 'spf_records' => array(), 'checks' => $checks, 'status' => 'ERROR',
                'lookup_count' => 0, 'lookup_limit' => self::MAX_LOOKUPS, 'mechanisms' => array(),
                'all_qualifier' => '', 'redirect' => '', 'summary' => 'No SPF record published.', 'explanation' => $explanation,
                'txt_records_seen' => count($allTxt),
            ), array('Publish an SPF record if this domain sends or forwards mail.'));
        }
        if (count($spfRecords) > 1) {
            $checks[] = $this->check('single_record', 'Exactly one SPF record', 'ERROR', 'Found ' . count($spfRecords) . ' SPF records. RFC 7208 permits exactly one; receivers treat multiple records as a permanent error (permerror).', $spfRecords);
        } else {
            $checks[] = $this->check('single_record', 'Exactly one SPF record', 'PASS', 'Exactly one SPF record was found.');
        }
        $record = $spfRecords[0];
        $parsed = $this->parse($record);
        if ($parsed['errors']) {
            foreach ($parsed['errors'] as $error) {
                $checks[] = $this->check('syntax', 'Syntax', 'ERROR', $error, array($record));
            }
        } else {
            $checks[] = $this->check('syntax', 'Syntax', 'PASS', 'Every mechanism and modifier parses against RFC 7208.');
        }
        foreach ($parsed['warnings'] as $warning) {
            $checks[] = $this->check('syntax_warning', 'Syntax warning', 'WARNING', $warning, array($record));
        }
        $lookupCount = 0;
        $expanded = array();
        if (!empty($this->input['expand'])) {
            $expansion = $this->expand($domain, $record, 0, array());
            $lookupCount = $expansion['lookups'];
            $expanded = $expansion['tree'];
            if ($expansion['error'] !== '') {
                $checks[] = $this->check('expansion', 'Include expansion', 'WARNING', $expansion['error']);
            }
        } else {
            $lookupCount = $this->countLookups($parsed['mechanisms']);
        }
        $checks[] = $this->check(
            'lookup_limit',
            'DNS lookup count',
            $lookupCount > self::MAX_LOOKUPS ? 'ERROR' : 'PASS',
            $lookupCount . ' DNS-lookup mechanism(s) counted against the RFC 7208 limit of ' . self::MAX_LOOKUPS . '.',
            array('counted' => $lookupCount, 'limit' => self::MAX_LOOKUPS)
        );
        if ($parsed['all_qualifier'] === '+') {
            $checks[] = $this->check('all_mechanism', 'all mechanism', 'WARNING', 'The record ends in "+all", which authorises every host on the internet to send mail for this domain.');
        } elseif ($parsed['all_qualifier'] !== '') {
            $checks[] = $this->check('all_mechanism', 'all mechanism', 'PASS', 'The record ends in "' . $parsed['all_qualifier'] . 'all", which is a valid explicit policy.');
        } else {
            $checks[] = $this->check('all_mechanism', 'all mechanism', 'WARNING', 'The record has no "all" mechanism, so unlisted senders get a neutral result and DMARC cannot act on SPF alone.');
        }
        $status = $this->rollup($checks);
        return ToolResult::success(array(
            'domain' => $domain,
            'spf_records' => $spfRecords,
            'record' => $record,
            'mechanisms' => $parsed['mechanisms'],
            'modifiers' => $parsed['modifiers'],
            'lookup_count' => $lookupCount,
            'lookup_limit' => self::MAX_LOOKUPS,
            'lookups_exceeded' => $lookupCount > self::MAX_LOOKUPS,
            'all_qualifier' => $parsed['all_qualifier'],
            'redirect' => isset($parsed['modifiers']['redirect']) ? $parsed['modifiers']['redirect'] : '',
            'include_tree' => $expanded,
            'checks' => $checks,
            'status' => $status,
            'summary' => 'SPF ' . strtolower($status) . ': ' . $lookupCount . ' DNS lookup(s).',
            'explanation' => 'Receivers evaluate the mechanisms in order. "include" and "redirect" expand to other domains\' policies; the ten-lookup limit exists because every expansion costs the receiver a DNS query.',
        ), array(), $this->meta($response));
    }

    private function parse($record)
    {
        $errors = array();
        $warnings = array();
        $mechanisms = array();
        $modifiers = array();
        $allQualifier = '';
        $parts = preg_split('/\s+/', trim($record));
        array_shift($parts); // v=spf1
        foreach ($parts as $part) {
            if ($part === '') {
                continue;
            }
            if (preg_match('/^([a-z][a-z0-9_.-]*)=(.+)$/i', $part, $matches)) {
                $name = strtolower($matches[1]);
                if (!in_array($name, array('redirect', 'exp'), true)) {
                    $warnings[] = 'Unknown modifier "' . $name . '=" is ignored by receivers.';
                } else {
                    $modifiers[$name] = $matches[2];
                }
                continue;
            }
            if (!preg_match('/^([+\-~?]?)([a-z0-9:._\/\-]+)(?:\/(\d{1,3}))?(\/\/(\d{1,3}))?$/i', $part, $matches)) {
                $errors[] = 'Mechanism "' . $part . '" is not valid SPF syntax.';
                continue;
            }
            $qualifier = $matches[1] === '' ? '+' : $matches[1];
            $name = strtolower($matches[2]);
            $mechanisms[] = array('raw' => $part, 'qualifier' => $qualifier, 'mechanism' => $name, 'cidr' => isset($matches[3]) ? $matches[3] : null);
            if ($name === 'all') {
                $allQualifier = $qualifier;
            }
            if ($name === 'ptr') {
                $warnings[] = 'The "ptr" mechanism is deprecated by RFC 7208 and is slow for receivers; prefer include or ip4/ip6.';
            }
        }
        return array('errors' => $errors, 'warnings' => $warnings, 'mechanisms' => $mechanisms, 'modifiers' => $modifiers, 'all_qualifier' => $allQualifier);
    }

    private function countLookups(array $mechanisms)
    {
        $count = 0;
        foreach ($mechanisms as $mechanism) {
            if (in_array($mechanism['mechanism'], self::LOOKUP_MECHANISMS, true)) {
                $count++;
            }
        }
        return $count;
    }

    private function expand($domain, $record, $depth, array $seen)
    {
        if ($depth >= self::MAX_DEPTH) {
            return array('lookups' => 0, 'tree' => array(), 'error' => 'Include expansion stopped at the maximum depth of ' . self::MAX_DEPTH . '.');
        }
        if (in_array($domain, $seen, true)) {
            return array('lookups' => 0, 'tree' => array(), 'error' => 'A circular include was detected at ' . $domain . '.');
        }
        $seen[] = $domain;
        $parsed = $this->parse($record);
        $lookups = $this->countLookups($parsed['mechanisms']);
        $tree = array();
        foreach ($parsed['mechanisms'] as $mechanism) {
            if ($mechanism['mechanism'] === 'include' && $mechanism['cidr'] === null) {
                $target = preg_replace('#^include:#i', '', $mechanism['raw']);
                $response = $this->querySystem($target, 'TXT');
                $childRecord = '';
                if ($response['ok']) {
                    foreach (DnsClient::values($response['records'], 'TXT') as $value) {
                        if (stripos(trim($value), 'v=spf1') === 0) {
                            $childRecord = trim($value);
                            break;
                        }
                    }
                }
                if ($childRecord === '') {
                    $lookups++;
                    $tree[] = array('domain' => $target, 'found' => false, 'lookups' => 1, 'error' => $response['ok'] ? 'No SPF record published at that include target.' : $response['error']);
                    continue;
                }
                $child = $this->expand($target, $childRecord, $depth + 1, $seen);
                $lookups += $child['lookups'];
                $tree[] = array('domain' => $target, 'found' => true, 'record' => $childRecord, 'lookups' => 1 + $child['lookups'], 'tree' => $child['tree'], 'error' => $child['error']);
            }
        }
        if (isset($parsed['modifiers']['redirect'])) {
            $target = $parsed['modifiers']['redirect'];
            $response = $this->querySystem($target, 'TXT');
            $childRecord = '';
            if ($response['ok']) {
                foreach (DnsClient::values($response['records'], 'TXT') as $value) {
                    if (stripos(trim($value), 'v=spf1') === 0) {
                        $childRecord = trim($value);
                        break;
                    }
                }
            }
            $lookups++;
            $tree[] = array('domain' => $target, 'found' => $childRecord !== '', 'record' => $childRecord, 'redirect' => true, 'lookups' => 1, 'error' => $childRecord === '' ? 'The redirect target publishes no SPF record.' : '');
        }
        return array('lookups' => $lookups, 'tree' => $tree, 'error' => '');
    }

    private function check($id, $label, $status, $message, array $evidence = array())
    {
        return array('id' => $id, 'label' => $label, 'status' => $status, 'message' => $message, 'evidence' => $evidence);
    }

    private function rollup(array $checks)
    {
        $status = 'PASS';
        foreach ($checks as $check) {
            if ($check['status'] === 'ERROR') {
                return 'ERROR';
            }
            if ($check['status'] === 'WARNING') {
                $status = 'WARNING';
            }
        }
        return $status;
    }
}
