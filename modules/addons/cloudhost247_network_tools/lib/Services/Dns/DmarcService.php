<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;

/**
 * DMARC Checker (docs section 9): reads _dmarc, validates every tag and
 * explains what the policy actually does at a receiver.
 */
final class DmarcService extends Service
{
    const VALID_POLICIES = array('none', 'quarantine', 'reject');
    const VALID_ALIGNMENT = array('r', 's');
    const VALID_FO = array('0', '1', 'd', 's');

    protected function execute()
    {
        $domain = $this->input['domain'];
        $name = '_dmarc.' . $domain;
        $response = $this->querySystem($name, 'TXT');
        $records = array();
        if ($response['ok']) {
            foreach (DnsClient::values($response['records'], 'TXT') as $value) {
                if (stripos(trim($value), 'v=DMARC1') === 0) {
                    $records[] = trim($value);
                }
            }
        }
        if (!$records) {
            $checks = array($this->check('dmarc_present', 'DMARC record present', 'ERROR',
                'No TXT record beginning with v=DMARC1 was found at ' . $name . '.',
                array('query' => $name, 'resolver_answer' => $response['ok'] ? 'answered, no DMARC record' : $response['error'])));
            return ToolResult::success(array(
                'domain' => $domain, 'query_name' => $name, 'dmarc_records' => array(), 'checks' => $checks,
                'status' => 'ERROR', 'policy' => '', 'tags' => array(),
                'summary' => 'No DMARC record published.',
                'explanation' => 'Without DMARC, SPF and DKIM results are not tied to the From domain, and receivers have no instruction for mail that fails both.',
                'policy_explanation' => '',
            ), array('A domain that sends mail should publish DMARC, starting with p=none and reporting enabled.'), $this->meta($response));
        }
        $checks = array();
        if (count($records) > 1) {
            $checks[] = $this->check('dmarc_single', 'Exactly one DMARC record', 'ERROR', 'Found ' . count($records) . ' DMARC records; receivers ignore the policy when more than one exists.', $records);
        } else {
            $checks[] = $this->check('dmarc_single', 'Exactly one DMARC record', 'PASS', 'Exactly one DMARC record was found.');
        }
        $parsed = $this->parse($records[0]);
        foreach ($parsed['errors'] as $error) {
            $checks[] = $this->check('dmarc_syntax', 'Syntax', 'ERROR', $error, array($records[0]));
        }
        foreach ($parsed['warnings'] as $warning) {
            $checks[] = $this->check('dmarc_syntax_warning', 'Syntax warning', 'WARNING', $warning, array($records[0]));
        }
        if (!$parsed['errors']) {
            $checks[] = $this->check('dmarc_syntax', 'Syntax', 'PASS', 'All tags and values are valid.');
        }
        $tags = $parsed['tags'];
        if (isset($tags['p']) && $tags['p'] === 'none') {
            $checks[] = $this->check('dmarc_enforcement', 'Policy enforcement', 'WARNING', 'p=none only requests reports: failing mail is still delivered. Move to quarantine or reject once reports look correct.', array('p' => 'none'));
        } else {
            $checks[] = $this->check('dmarc_enforcement', 'Policy enforcement', 'PASS', 'The policy asks receivers to act on failing mail (p=' . (isset($tags['p']) ? $tags['p'] : '?') . ').');
        }
        if (isset($tags['sp']) && $tags['sp'] === 'none' && isset($tags['p']) && $tags['p'] !== 'none') {
            $checks[] = $this->check('dmarc_subdomain', 'Subdomain policy', 'WARNING', 'sp=none leaves subdomains unprotected while the parent domain is enforced.');
        }
        if (isset($tags['pct']) && (int) $tags['pct'] < 100) {
            $checks[] = $this->check('dmarc_pct', 'Percentage (pct)', 'WARNING', 'pct=' . $tags['pct'] . ' means the receiver applies the policy to only ' . $tags['pct'] . '% of failing messages.', array('pct' => $tags['pct']));
        }
        foreach (array('rua', 'ruf') as $reportTag) {
            if (!isset($tags[$reportTag])) {
                if ($reportTag === 'rua') {
                    $checks[] = $this->check('dmarc_rua', 'Aggregate reporting (rua)', 'WARNING', 'No rua address is published, so you will not receive aggregate reports about how your mail authenticates.');
                }
                continue;
            }
            $addresses = preg_split('/[,\s]+/', (string) $tags[$reportTag], -1, PREG_SPLIT_NO_EMPTY);
            foreach ($addresses as $address) {
                if (stripos($address, 'mailto:') !== 0 || filter_var(substr($address, 7), FILTER_VALIDATE_EMAIL) === false) {
                    $checks[] = $this->check('dmarc_' . $reportTag, 'Reporting address (' . $reportTag . ')', 'ERROR', 'The ' . $reportTag . ' entry "' . $address . '" is not a valid mailto: address.', array($address));
                }
            }
        }
        $status = 'PASS';
        foreach ($checks as $check) {
            if ($check['status'] === 'ERROR') { $status = 'ERROR'; break; }
            if ($check['status'] === 'WARNING') { $status = 'WARNING'; }
        }
        $policy = isset($tags['p']) ? $tags['p'] : '';
        return ToolResult::success(array(
            'domain' => $domain,
            'query_name' => $name,
            'dmarc_records' => $records,
            'record' => $records[0],
            'tags' => $tags,
            'unknown_tags' => $parsed['unknown'],
            'policy' => $policy,
            'policy_explanation' => $this->explainPolicy($policy, isset($tags['pct']) ? $tags['pct'] : 100),
            'reporting' => array('rua' => isset($tags['rua']) ? $tags['rua'] : '', 'ruf' => isset($tags['ruf']) ? $tags['ruf'] : ''),
            'checks' => $checks,
            'status' => $status,
            'summary' => 'DMARC policy p=' . ($policy === '' ? 'missing' : $policy) . '.',
            'explanation' => 'DMARC compares the From domain with the domain SPF and DKIM authenticated. Alignment decides how close they must match (relaxed: the same registrable domain; strict: an exact match).',
        ), array(), $this->meta($response));
    }

    private function parse($record)
    {
        $errors = array();
        $warnings = array();
        $tags = array();
        $unknown = array();
        $parts = explode(';', $record);
        foreach ($parts as $part) {
            $part = trim($part);
            if ($part === '') {
                continue;
            }
            if (stripos($part, 'v=DMARC1') === 0) {
                continue;
            }
            if (strpos($part, '=') === false) {
                $errors[] = 'Tag "' . $part . '" is not in name=value form.';
                continue;
            }
            list($name, $value) = array_map('trim', explode('=', $part, 2));
            $name = strtolower($name);
            if (isset($tags[$name])) {
                $warnings[] = 'Tag "' . $name . '" appears more than once; receivers use the first occurrence.';
                continue;
            }
            $tags[$name] = $value;
        }
        if (!isset($tags['p'])) {
            $errors[] = 'The required p= tag is missing.';
        } elseif (!in_array(strtolower($tags['p']), self::VALID_POLICIES, true)) {
            $errors[] = 'p=' . $tags['p'] . ' is not a valid policy (none, quarantine, reject).';
        }
        if (isset($tags['sp']) && !in_array(strtolower($tags['sp']), self::VALID_POLICIES, true)) {
            $errors[] = 'sp=' . $tags['sp'] . ' is not a valid policy.';
        }
        if (isset($tags['pct'])) {
            if (!ctype_digit((string) $tags['pct']) || (int) $tags['pct'] < 0 || (int) $tags['pct'] > 100) {
                $errors[] = 'pct must be an integer between 0 and 100.';
            }
        }
        foreach (array('adkim', 'aspf') as $alignment) {
            if (isset($tags[$alignment]) && !in_array(strtolower($tags[$alignment]), self::VALID_ALIGNMENT, true)) {
                $errors[] = $alignment . ' must be r (relaxed) or s (strict).';
            }
        }
        if (isset($tags['fo']) && !in_array(strtolower($tags['fo']), self::VALID_FO, true)) {
            $errors[] = 'fo=' . $tags['fo'] . ' is not one of 0, 1, d, s.';
        }
        if (isset($tags['ri']) && (!ctype_digit((string) $tags['ri']) || (int) $tags['ri'] < 0)) {
            $errors[] = 'ri must be a number of seconds.';
        }
        foreach ($tags as $name => $value) {
            if (!in_array($name, array('v', 'p', 'sp', 'pct', 'rua', 'ruf', 'adkim', 'aspf', 'fo', 'ri', 'rf', 'np'), true)) {
                $unknown[] = $name;
            }
        }
        if ($unknown) {
            $warnings[] = 'Unknown tag(s) ignored by receivers: ' . implode(', ', $unknown) . '.';
        }
        return array('errors' => $errors, 'warnings' => $warnings, 'tags' => $tags, 'unknown' => $unknown);
    }

    private function explainPolicy($policy, $pct)
    {
        switch (strtolower((string) $policy)) {
            case 'none':
                return 'p=none asks receivers to take no action on failing mail. It is the correct starting point while you collect reports, and it provides no protection yet.';
            case 'quarantine':
                return 'p=quarantine asks receivers to treat failing mail as suspicious (usually spam or junk). Some legitimate mail can be affected if all senders are not yet covered by SPF or DKIM.';
            case 'reject':
                return 'p=reject asks receivers to refuse failing mail outright. This is the strongest policy; make sure every legitimate sender for the domain passes SPF or DKIM before you publish it.';
            default:
                return '';
        }
    }

    private function check($id, $label, $status, $message, array $evidence = array())
    {
        return array('id' => $id, 'label' => $label, 'status' => $status, 'message' => $message, 'evidence' => $evidence);
    }
}
