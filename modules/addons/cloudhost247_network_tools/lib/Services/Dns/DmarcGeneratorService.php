<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * DMARC Record Generator (docs section 11): local, deterministic construction of
 * a DMARC TXT value with validation of the addresses the user enters.
 */
final class DmarcGeneratorService extends Service
{
    protected function execute()
    {
        $domain = $this->input['domain'];
        $policy = strtolower($this->input['policy']);
        $tags = array('v' => 'DMARC1', 'p' => $policy);
        $subdomain = isset($this->input['subdomain_policy']) ? strtolower((string) $this->input['subdomain_policy']) : '';
        if ($subdomain !== '') {
            $tags['sp'] = $subdomain;
        }
        $pct = isset($this->input['percentage']) ? (int) $this->input['percentage'] : 100;
        if ($pct !== 100) {
            $tags['pct'] = (string) $pct;
        }
        $addresses = array();
        foreach (array('rua', 'ruf') as $tag) {
            if (empty($this->input[$tag])) {
                continue;
            }
            $list = array();
            foreach (preg_split('/[,\s]+/', (string) $this->input[$tag], -1, PREG_SPLIT_NO_EMPTY) as $entry) {
                if (stripos($entry, 'mailto:') !== 0) {
                    $entry = 'mailto:' . $entry;
                }
                if (filter_var(substr($entry, 7), FILTER_VALIDATE_EMAIL) === false) {
                    return ToolResult::invalid('The ' . $tag . ' address "' . $entry . '" is not a valid email address.');
                }
                $list[] = $entry;
            }
            if ($list) {
                $tags[$tag] = implode(',', $list);
                $addresses[$tag] = $list;
            }
        }
        foreach (array('adkim', 'aspf') as $tag) {
            if (!empty($this->input[$tag]) && $this->input[$tag] !== 'r') {
                $tags[$tag] = (string) $this->input[$tag];
            }
        }
        if (!empty($this->input['fo']) && $this->input['fo'] !== '0') {
            $tags['fo'] = (string) $this->input['fo'];
        }
        if (isset($this->input['ri']) && (int) $this->input['ri'] !== 86400) {
            $tags['ri'] = (string) (int) $this->input['ri'];
        }
        $parts = array();
        foreach ($tags as $name => $value) {
            $parts[] = $name . '=' . $value;
        }
        $record = implode('; ', $parts);
        $host = '_dmarc.' . $domain;
        $warnings = array();
        if ($policy === 'reject' && $pct < 100) {
            $warnings[] = 'p=reject with pct below 100 is unusual: receivers apply the policy to only part of the failing mail, which can look inconsistent to your own reporting.';
        }
        if ($policy !== 'none' && !isset($tags['rua'])) {
            $warnings[] = 'No aggregate reporting address was supplied. Without rua you will not see what fails, which makes enforcement hard to operate safely.';
        }
        if ($policy === 'none') {
            $warnings[] = 'p=none is a monitoring policy: it does not block or quarantine anything. Publish it first, review the reports, then move to quarantine and reject.';
        }
        return ToolResult::success(array(
            'domain' => $domain,
            'host' => $host,
            'record_type' => 'TXT',
            'record' => $record,
            'tags' => $tags,
            'reporting_addresses' => $addresses,
            'recommended_step' => $policy === 'none'
                ? 'Recommended next step: leave p=none with rua reporting for at least two weeks, then raise to quarantine.'
                : 'Before enforcing, confirm every legitimate sender for the domain passes SPF or DKIM alignment.',
            'summary' => 'Publish a TXT record at ' . $host . ' with the value shown.',
        ), $warnings, array('generated_at' => gmdate('c'), 'client_side_possible' => true));
    }
}
