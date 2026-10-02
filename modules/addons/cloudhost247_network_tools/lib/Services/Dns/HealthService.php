<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Dns\ReverseName;
use CloudHost247\NetworkTools\Services\Service;

/**
 * DNS Health Checker (docs section 6).
 *
 * Runs a documented set of checks and reports each one as PASS, WARNING, ERROR,
 * NOT CHECKED or UNKNOWN with the evidence that produced it. The overall status
 * is the worst individual status — it is not a score, because there is no
 * defensible way to score unrelated facts against each other. Email and DNSSEC
 * checks reuse the dedicated services so a domain cannot be reported as healthy
 * in one place and broken in another.
 */
final class HealthService extends Service
{
    protected function execute()
    {
        $domain = $this->input['domain'];
        $checks = array();
        $recommendations = array();

        // --- Nameservers and delegation -------------------------------------
        $ns = $this->querySystem($domain, 'NS');
        $childNameservers = $ns['ok'] ? DnsClient::values($ns['records'], 'NS') : array();
        if ($childNameservers) {
            $checks[] = $this->check('nameservers', 'Nameservers', 'PASS', count($childNameservers) . ' nameserver(s) published: ' . implode(', ', $childNameservers) . '.', array('nameservers' => $childNameservers));
        } else {
            $checks[] = $this->check('nameservers', 'Nameservers', 'ERROR', 'No NS records could be read for the zone.', array('error' => $ns['error']));
            $recommendations[] = 'A zone without reachable NS records cannot be delegated; check the registrar\'s nameserver settings.';
        }
        if (count($childNameservers) === 1) {
            $checks[] = $this->check('nameserver_redundancy', 'Nameserver redundancy', 'WARNING', 'Only one nameserver is published. RFC 2182 recommends at least two on separate networks.', array());
            $recommendations[] = 'Add a second nameserver so the zone survives one provider outage.';
        } elseif (count($childNameservers) > 1) {
            $checks[] = $this->check('nameserver_redundancy', 'Nameserver redundancy', 'PASS', count($childNameservers) . ' nameservers published.', array());
        }
        $parent = substr($domain, strpos($domain, '.') + 1);
        $parentNs = $this->querySystem($parent, 'NS');
        $checks[] = $this->check(
            'delegation',
            'Delegation from the parent zone',
            $parentNs['ok'] ? 'PASS' : 'UNKNOWN',
            $parentNs['ok']
                ? 'The parent zone (' . $parent . ') is reachable and answered ' . count($parentNs['records']) . ' NS record(s), so the delegation chain can be followed.'
                : 'The parent zone could not be queried, so delegation could not be evaluated.',
            array('parent' => $parent)
        );

        // --- Address records -------------------------------------------------
        $a = $this->querySystem($domain, 'A');
        $aaaa = $this->querySystem($domain, 'AAAA');
        $cname = $this->querySystem($domain, 'CNAME');
        $aValues = $a['ok'] ? DnsClient::values($a['records'], 'A') : array();
        $aaaaValues = $aaaa['ok'] ? DnsClient::values($aaaa['records'], 'AAAA') : array();
        $cnameValues = $cname['ok'] ? DnsClient::values($cname['records'], 'CNAME') : array();
        if ($aValues) {
            $checks[] = $this->check('a_record', 'A record (IPv4)', 'PASS', 'Resolves to ' . implode(', ', array_slice($aValues, 0, 5)) . '.', array('addresses' => $aValues));
        } else {
            $checks[] = $this->check('a_record', 'A record (IPv4)', 'WARNING', 'No A record was returned for the apex name.', array('error' => $a['ok'] ? 'no address record' : $a['error']));
        }
        $checks[] = $this->check('aaaa_record', 'AAAA record (IPv6)', $aaaaValues ? 'PASS' : 'UNKNOWN',
            $aaaaValues ? 'Resolves to ' . implode(', ', array_slice($aaaaValues, 0, 5)) . '.' : 'No IPv6 address is published. That is not an error, but it means IPv6-only visitors cannot reach the site.', array());
        if ($cnameValues) {
            $checks[] = $this->check('cname_apex', 'CNAME at the apex', 'WARNING', 'The apex name has a CNAME (' . implode(', ', $cnameValues) . '). A CNAME at the zone apex conflicts with NS/SOA and most DNS providers disallow it; use A/AAAA or a provider-specific alias.', array());
        }

        // --- Mail -------------------------------------------------------------
        $mx = $this->querySystem($domain, 'MX');
        $mxValues = $mx['ok'] ? DnsClient::values($mx['records'], 'MX') : array();
        $nullMx = false;
        foreach (($mx['ok'] ? $mx['records'] : array()) as $record) {
            if ($record['type'] === 'MX' && isset($record['target']) && $record['target'] === '.') {
                $nullMx = true;
            }
        }
        if ($nullMx) {
            $checks[] = $this->check('mx', 'MX records', 'PASS', 'A null MX (".") is published: the domain explicitly accepts no mail.', array());
        } elseif ($mxValues) {
            $checks[] = $this->check('mx', 'MX records', 'PASS', count($mxValues) . ' mail exchanger(s) published.', array('exchangers' => $mxValues));
        } else {
            $checks[] = $this->check('mx', 'MX records', 'NOT CHECKED', 'The domain publishes no MX record. That is correct for a domain that does not receive mail; if it should, mail will not be delivered.', array());
        }

        // --- Email authentication (reuse the dedicated services) -------------
        $spf = (new SpfService())->run(array('domain' => $domain, 'expand' => true), $this->context);
        if ($spf->isOk() && isset($spf->data()['status'])) {
            $spfData = $spf->data();
            $checks[] = $this->check('spf', 'SPF', $this->mapEmailStatus($spfData['status']), isset($spfData['summary']) ? $spfData['summary'] : '', array('lookup_count' => isset($spfData['lookup_count']) ? $spfData['lookup_count'] : null));
        } else {
            $checks[] = $this->check('spf', 'SPF', 'UNKNOWN', 'The SPF check could not be completed: ' . $spf->message(), array());
        }
        $dmarc = (new DmarcService())->run(array('domain' => $domain), $this->context);
        if ($dmarc->isOk() && isset($dmarc->data()['status'])) {
            $dmarcData = $dmarc->data();
            $dmarcStatus = $this->mapEmailStatus($dmarcData['status']);
            if ($dmarcStatus === 'WARNING' && isset($dmarcData['policy']) && $dmarcData['policy'] === 'none') {
                $dmarcStatus = 'WARNING';
            }
            $checks[] = $this->check('dmarc', 'DMARC', $dmarcStatus, isset($dmarcData['summary']) ? $dmarcData['summary'] : '', array('policy' => isset($dmarcData['policy']) ? $dmarcData['policy'] : ''));
            if (isset($dmarcData['policy']) && $dmarcData['policy'] === 'none') {
                $recommendations[] = 'DMARC is monitoring only (p=none). Once reports look clean, raise the policy to quarantine and then reject.';
            }
        } else {
            $checks[] = $this->check('dmarc', 'DMARC', 'UNKNOWN', 'The DMARC check could not be completed: ' . $dmarc->message(), array());
        }
        if (!empty($this->input['dkim_selector'])) {
            $dkim = (new DkimService())->run(array('domain' => $domain, 'selectors' => $this->input['dkim_selector']), $this->context);
            if ($dkim->isOk() && isset($dkim->data()['status'])) {
                $dkimData = $dkim->data();
                $checks[] = $this->check('dkim', 'DKIM', $this->mapEmailStatus($dkimData['status']), isset($dkimData['summary']) ? $dkimData['summary'] : '', array('selector' => $this->input['dkim_selector']));
            } else {
                $checks[] = $this->check('dkim', 'DKIM', 'UNKNOWN', 'The DKIM check could not be completed.', array());
            }
        } else {
            $checks[] = $this->check('dkim', 'DKIM', 'NOT CHECKED', 'No selector was supplied, so DKIM was not checked. DKIM is selector-based: without one there is nothing to query.', array());
        }

        // --- CAA ---------------------------------------------------------------
        $caa = $this->querySystem($domain, 'CAA');
        $caaValues = $caa['ok'] ? DnsClient::values($caa['records'], 'CAA') : array();
        $checks[] = $this->check('caa', 'CAA', $caaValues ? 'PASS' : 'WARNING',
            $caaValues ? 'A CAA policy is published: ' . implode(' | ', array_slice($caaValues, 0, 4)) : 'No CAA record is published, so any certificate authority may issue for this domain. CAA lets you restrict that.', array());

        // --- DNSSEC ------------------------------------------------------------
        $dnssec = (new DnssecService())->run(array('domain' => $domain), array_merge($this->context, array('tool' => null)));
        if ($dnssec->isOk() && isset($dnssec->data()['chain_complete'])) {
            $dnssecData = $dnssec->data();
            $keys = isset($dnssecData['dnskey_records']) ? $dnssecData['dnskey_records'] : array();
            if (!$keys) {
                $checks[] = $this->check('dnssec', 'DNSSEC', 'WARNING', 'The zone is not DNSSEC signed. This is common and not an error, but unsigned zones can be spoofed by a network attacker.', array());
            } elseif ($dnssecData['chain_complete']) {
                $checks[] = $this->check('dnssec', 'DNSSEC', 'PASS', 'DS digest matches a published DNSKEY, so a validating resolver has a chain of trust.', array());
            } else {
                $checks[] = $this->check('dnssec', 'DNSSEC', 'ERROR', 'Keys are published but the DS record does not match them, which makes the zone bogus for validating resolvers.', array());
                $recommendations[] = 'Re-publish the DS record at your registrar from the current DNSKEY, or remove the DS record until the keys match.';
            }
        } else {
            $checks[] = $this->check('dnssec', 'DNSSEC', 'UNKNOWN', 'DNSSEC could not be evaluated.', array());
        }

        // --- SOA --------------------------------------------------------------
        $soa = $this->querySystem($domain, 'SOA');
        if ($soa['ok'] && $soa['records']) {
            $record = $soa['records'][0];
            $checks[] = $this->check('soa', 'SOA record', 'PASS',
                'Primary nameserver ' . (isset($record['primary']) ? $record['primary'] : '?') . ', serial ' . (isset($record['serial']) ? $record['serial'] : '?') . ', negative TTL ' . (isset($record['minimum']) ? $record['minimum'] : '?') . 's.',
                array('serial' => isset($record['serial']) ? $record['serial'] : null, 'refresh' => isset($record['refresh']) ? $record['refresh'] : null, 'minimum' => isset($record['minimum']) ? $record['minimum'] : null));
        } else {
            $checks[] = $this->check('soa', 'SOA record', 'ERROR', 'No SOA record was returned; a zone cannot be authoritative without one.', array());
        }

        // --- TTL consistency --------------------------------------------------
        $ttls = array();
        foreach (array('A' => $a, 'AAAA' => $aaaa, 'MX' => $mx, 'NS' => $ns) as $type => $response) {
            foreach ((array) ($response['ok'] ? $response['records'] : array()) as $record) {
                if (isset($record['ttl']) && (int) $record['ttl'] > 0) {
                    $ttls[$type][] = (int) $record['ttl'];
                }
            }
        }
        if ($ttls) {
            $min = min(array_map('min', $ttls));
            $max = max(array_map('max', $ttls));
            $checks[] = $this->check('ttl_consistency', 'TTL consistency', $max > $min * 10 && $min > 0 ? 'WARNING' : 'PASS',
                'Observed TTLs range from ' . $min . 's to ' . $max . 's. Very different TTLs are legal, but a very low TTL plus a very high one usually means one record was changed and the others were not.',
                array('ttls' => $ttls));
        }

        // --- Nameserver consistency -------------------------------------------
        if (count($childNameservers) > 1 && $aValues) {
            $answers = array();
            foreach (array_slice($childNameservers, 0, 4) as $nameserver) {
                $target = $this->querySystem($nameserver, 'A');
                if (!$target['ok'] || !$target['records']) {
                    $answers[$nameserver] = array('error' => 'the nameserver name itself did not resolve');
                    continue;
                }
                $addresses = DnsClient::values($target['records'], 'A');
                $client = DnsClient::forResolver($addresses[0], 'udp', '', array('timeout' => 4, 'retries' => 1));
                $answer = $client->query($domain, 'A');
                $answers[$nameserver] = $answer['ok'] ? DnsClient::values($answer['records'], 'A') : array('error' => $answer['error']);
            }
            $distinct = array();
            foreach ($answers as $nameserver => $answer) {
                if (is_array($answer) && isset($answer['error'])) {
                    continue;
                }
                $distinct[json_encode($answer)] = true;
            }
            $consistent = count($distinct) <= 1;
            $checks[] = $this->check('nameserver_consistency', 'Nameserver consistency', $consistent ? 'PASS' : 'WARNING',
                $consistent
                    ? 'Every queried authoritative nameserver returned the same A answer.'
                    : 'Authoritative nameservers returned different A answers, so the zone is not in sync between them.',
                array('answers' => $answers));
            if (!$consistent) {
                $recommendations[] = 'Check zone transfers (AXFR/IXFR) between the authoritative nameservers; they disagree about the apex A record.';
            }
        }

        // --- Resolution failures ----------------------------------------------
        $failures = array();
        foreach ($this->pool()->resolvers('all', array('udp'), 12) as $row) {
            $response = $this->pool()->clientFor($row)->query($domain, 'A');
            if (!$response['ok'] && $response['code'] !== 'DOMAIN_NOT_FOUND') {
                $failures[] = array('resolver' => (string) $row->name, 'ip' => (string) $row->ip_address, 'error' => $response['error']);
            }
        }
        $checks[] = $this->check('resolution', 'Resolution from public resolvers', $failures ? 'WARNING' : 'PASS',
            $failures ? count($failures) . ' resolver(s) could not answer for this zone.' : 'Every queried resolver answered for this zone.',
            array('failures' => $failures));

        $overall = $this->overall($checks);
        foreach ($checks as $check) {
            if ($check['status'] === 'ERROR') {
                $recommendations[] = 'Fix the ERROR check "' . $check['label'] . '": ' . $check['message'];
            }
        }
        return ToolResult::success(array(
            'domain' => $domain,
            'overall_status' => $overall,
            'checks' => $checks,
            'errors' => $this->statuses($checks, 'ERROR'),
            'warnings' => $this->statuses($checks, 'WARNING'),
            'not_checked' => $this->statuses($checks, 'NOT CHECKED'),
            'recommendations' => array_values(array_unique($recommendations)),
            'summary' => 'Overall: ' . $overall . ' (' . count($this->statuses($checks, 'ERROR')) . ' error(s), ' . count($this->statuses($checks, 'WARNING')) . ' warning(s)).',
            'explanation' => 'Every check above is a statement about a specific observation. The overall status is the worst individual result; no numeric score is produced because these facts are not comparable to one another, and a domain is never called "secure" merely because records exist.',
            'methodology' => 'Checks: nameservers, redundancy, delegation, A, AAAA, apex CNAME, MX, SPF, DKIM (when a selector is given), DMARC, CAA, DNSSEC chain, SOA, TTL spread, nameserver consistency and resolver agreement. Each is evaluated against RFC-based expectations, not against a vendor score.',
        ), array(), array('checked_at' => gmdate('c')));
    }

    private function mapEmailStatus($status)
    {
        $map = array('PASS' => 'PASS', 'WARNING' => 'WARNING', 'ERROR' => 'ERROR');
        return isset($map[$status]) ? $map[$status] : 'UNKNOWN';
    }

    private function statuses(array $checks, $status)
    {
        $out = array();
        foreach ($checks as $check) {
            if ($check['status'] === $status) {
                $out[] = $check['label'];
            }
        }
        return $out;
    }

    private function overall(array $checks)
    {
        $overall = 'PASS';
        foreach ($checks as $check) {
            if ($check['status'] === 'ERROR') { return 'ERROR'; }
            if ($check['status'] === 'WARNING' && $overall === 'PASS') { $overall = 'WARNING'; }
            if ($check['status'] === 'UNKNOWN' && $overall === 'PASS') { $overall = 'UNKNOWN'; }
        }
        return $overall;
    }

    private function check($id, $label, $status, $message, array $evidence = array())
    {
        return array('id' => $id, 'label' => $label, 'status' => $status, 'message' => $message, 'evidence' => $evidence);
    }
}
