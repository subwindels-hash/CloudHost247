<?php
namespace CloudHost247\NetworkTools\Services\Context;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use CloudHost247\NetworkTools\Services\Dns\DkimService;
use CloudHost247\NetworkTools\Services\Dns\DmarcService;
use CloudHost247\NetworkTools\Services\Dns\HealthService;
use CloudHost247\NetworkTools\Services\Dns\SpfService;
use CloudHost247\NetworkTools\Services\Developer\HttpHeadersService;
use CloudHost247\NetworkTools\Services\Security\SslService;
use CloudHost247\NetworkTools\Services\Service;
use WHMCS\Database\Capsule;

/**
 * Domain Health Centre (docs section 80).
 *
 * Runs the checks this module already owns — DNS health, email authentication,
 * TLS, HTTP and (when a provider is configured) the blacklist — and reports, per
 * check, one of PASS / WARNING / ERROR / NOT CHECKED / UNKNOWN with the evidence
 * behind it.
 *
 * There is no score. A domain is never called "secure" because records exist:
 * each verdict comes from a specific observation, and a check that could not run
 * is NOT CHECKED. The overall line is the worst verdict among the checks that
 * actually ran, and the methodology is returned with the data.
 */
final class DomainHealthService extends Service
{
    protected function execute()
    {
        $domain = TargetValidator::domain($this->input['domain']);
        $selector = !empty($this->input['dkim_selector']) ? (string) $this->input['dkim_selector'] : 'default';
        // --- DNS and zone ---------------------------------------------------
        $dns = (new HealthService())->run(array('domain' => $domain, 'dkim_selector' => $selector), $this->context);
        $dnsChecks = array();
        if ($dns->isOk()) {
            $dnsData = $dns->data();
            foreach ((array) (isset($dnsData['checks']) ? $dnsData['checks'] : array()) as $check) {
                $identifier = isset($check['id']) ? $check['id'] : 'check';
                $dnsChecks[] = $this->check('dns.' . $identifier, isset($check['label']) ? $check['label'] : 'DNS check', isset($check['status']) ? $check['status'] : 'UNKNOWN', isset($check['message']) ? $check['message'] : '', isset($check['evidence']) ? $check['evidence'] : array());
            }
        } else {
            $dnsChecks[] = $this->check('dns.zone', 'DNS zone', 'NOT CHECKED', 'The DNS audit could not run: ' . $dns->message(), array());
        }

        // --- Email authentication ------------------------------------------
        $emailChecks = array();
        $spf = (new SpfService())->run(array('domain' => $domain), $this->context);
        $emailChecks[] = $this->fromService('email.spf', 'SPF', $spf);
        $dmarc = (new DmarcService())->run(array('domain' => $domain), $this->context);
        $emailChecks[] = $this->fromService('email.dmarc', 'DMARC', $dmarc);
        $dkim = (new DkimService())->run(array('domain' => $domain, 'selectors' => $selector), $this->context);
        $emailChecks[] = $this->fromService('email.dkim', 'DKIM (' . $selector . ')', $dkim);

        // --- HTTPS, TLS and headers ----------------------------------------
        $webChecks = array();
        $ssl = (new SslService())->run(array('host' => $domain, 'port' => 443), $this->context);
        if ($ssl->isOk()) {
            $sslData = $ssl->data();
            $days = isset($sslData['days_remaining']) ? (int) $sslData['days_remaining'] : null;
            $status = 'PASS';
            $detail = 'Certificate valid for ' . $days . ' more day(s).';
            if ($days !== null && $days < 0) {
                $status = 'ERROR';
                $detail = 'The certificate expired ' . abs($days) . ' day(s) ago.';
            } elseif ($days !== null && $days <= 14) {
                $status = 'WARNING';
                $detail = 'The certificate expires in ' . $days . ' day(s). Renewal should be verified now.';
            }
            $webChecks[] = $this->check('web.tls', 'TLS certificate', $status, $detail, array('verified' => !empty($sslData['verification']['verified']), 'issuer' => isset($sslData['issuer']['organization']) ? $sslData['issuer']['organization'] : '', 'valid_to' => isset($sslData['valid_to']) ? $sslData['valid_to'] : ''));
        } else {
            $webChecks[] = $this->check('web.tls', 'TLS certificate', 'NOT CHECKED', 'The TLS check could not run: ' . $ssl->message(), array());
        }
        $headers = (new HttpHeadersService())->run(array('url' => 'https://' . $domain . '/'), $this->context);
        if ($headers->isOk()) {
            $headerData = $headers->data();
            $missing = array();
            foreach ((array) (isset($headerData['security_headers']) ? $headerData['security_headers'] : array()) as $header) {
                if (isset($header['present']) && !$header['present']) {
                    $missing[] = isset($header['name']) ? $header['name'] : '';
                }
            }
            $webChecks[] = $this->check('web.headers', 'HTTP security headers', $missing ? 'WARNING' : 'PASS', $missing ? 'Missing or weak: ' . implode(', ', array_slice(array_filter($missing), 0, 8)) . '.' : 'The browser-security headers this module looks for are present.', array('missing' => array_values(array_filter($missing))));
        } else {
            $webChecks[] = $this->check('web.headers', 'HTTP security headers', 'NOT CHECKED', 'The page could not be fetched: ' . $headers->message(), array());
        }

        // --- Registration data (bounded WHOIS over TCP 43) ------------------
        $registrationChecks = array();
        try {
            $lookup = (new \CloudHost247\NetworkTools\Services\Shared\WhoisClient())->queryDomain($domain);
            if ($lookup['ok']) {
                $fields = \CloudHost247\NetworkTools\Services\Shared\WhoisClient::parse($lookup['text']);
                $expiry = '';
                $registrar = '';
                foreach (array('registry expiry date', 'expiry date', 'expiration date', 'expires', 'paid-till', 'registrar registration expiration date') as $key) {
                    if (isset($fields[$key]) && (string) $fields[$key] !== '') {
                        $expiry = (string) $fields[$key];
                        break;
                    }
                }
                foreach (array('registrar', 'sponsoring registrar', 'registrar name') as $key) {
                    if (isset($fields[$key]) && (string) $fields[$key] !== '') {
                        $registrar = (string) $fields[$key];
                        break;
                    }
                }
                $status = 'PASS';
                $detail = 'Registration data was read from ' . $lookup['server'] . '.';
                if ($registrar !== '') {
                    $detail .= ' Registrar: ' . $registrar . '.';
                }
                if ($expiry !== '') {
                    $timestamp = strtotime($expiry);
                    if ($timestamp !== false) {
                        $daysLeft = (int) floor(($timestamp - time()) / 86400);
                        $detail .= ' The registration expires in ' . $daysLeft . ' day(s).';
                        if ($daysLeft < 0) {
                            $status = 'ERROR';
                        } elseif ($daysLeft <= 30) {
                            $status = 'WARNING';
                        }
                    } else {
                        $detail .= ' Expiry as published: ' . $expiry . '.';
                    }
                }
                $registrationChecks[] = $this->check('registration.whois', 'Registration data', $status, $detail, array('registrar' => $registrar, 'expiry' => $expiry, 'queried_server' => $lookup['server']));
            } else {
                $registrationChecks[] = $this->check('registration.whois', 'Registration data', 'NOT CHECKED', 'Registrar data could not be read: ' . $lookup['error'] . ' This is usually a registry rate limit, a privacy-protected record or a TLD whose WHOIS format is not machine readable — not a problem with the domain itself.', array());
            }
        } catch (\Throwable $unavailable) {
            $registrationChecks[] = $this->check('registration.whois', 'Registration data', 'NOT CHECKED', 'Registrar data could not be read in this environment.', array());
        }

        // --- CloudHost247 hosting context (own domains only) ----------------
        $hosting = $this->hostingContext($domain);

        $allChecks = array_merge($dnsChecks, $emailChecks, $webChecks, $registrationChecks);
        $counts = array('PASS' => 0, 'WARNING' => 0, 'ERROR' => 0, 'NOT CHECKED' => 0, 'UNKNOWN' => 0);
        foreach ($allChecks as $check) {
            $status = $check['status'];
            if (!isset($counts[$status])) {
                $status = 'UNKNOWN';
            }
            $counts[$status]++;
        }
        $overall = 'PASS';
        foreach (array('ERROR', 'WARNING', 'UNKNOWN', 'NOT CHECKED') as $candidate) {
            if ($counts[$candidate] > 0) {
                $overall = $candidate === 'NOT CHECKED' && $counts['PASS'] > 0 ? 'WARNING' : $candidate;
                if ($candidate === 'NOT CHECKED') {
                    $overall = $counts['ERROR'] > 0 || $counts['WARNING'] > 0 ? $overall : 'WARNING';
                }
                break;
            }
        }
        $warnings = array();
        if ($counts['NOT CHECKED'] > 0) {
            $warnings[] = $counts['NOT CHECKED'] . ' check(s) could not run. They are reported as NOT CHECKED and were not counted as failures or successes.';
        }
        $warnings[] = 'This report describes the checks listed below at the moment they ran. A domain is not "secure" because records exist: each verdict below is the result of one specific observation, and nothing here replaces an audit of the application itself.';
        return ToolResult::success(array(
            'domain' => $domain,
            'dkim_selector' => $selector,
            'overall' => $overall,
            'counts' => $counts,
            'checks' => $allChecks,
            'sections' => array(
                'dns' => $dnsChecks,
                'email' => $emailChecks,
                'web' => $webChecks,
                'registration' => $registrationChecks,
            ),
            'hosting_context' => $hosting,
            'methodology' => 'Each check is performed by the same service the standalone tool uses, and each reports its own verdict with the evidence it observed: PASS, WARNING, ERROR, NOT CHECKED or UNKNOWN. The overall line is the worst verdict among the checks that ran. No numeric score is produced, because a score would hide which check failed and why.',
            'generated_at' => gmdate('c'),
            'summary' => 'Overall: ' . $overall . ' — ' . $counts['PASS'] . ' pass, ' . $counts['WARNING'] . ' warning, ' . $counts['ERROR'] . ' error, ' . $counts['NOT CHECKED'] . ' not checked.',
        ), $warnings, array('checks_run' => count($allChecks), 'score_produced' => false));
    }

    private function fromService($key, $label, ToolResult $result)
    {
        if (!$result->isOk()) {
            return $this->check($key, $label, 'NOT CHECKED', $result->message(), array());
        }
        $data = $result->data();
        $status = 'PASS';
        if (isset($data['status'])) {
            $status = $this->mapStatus((string) $data['status']);
        } elseif (isset($data['valid']) && $data['valid'] === false) {
            $status = 'ERROR';
        }
        $detail = isset($data['summary']) ? (string) $data['summary'] : $label . ' was checked.';
        return $this->check($key, $label, $status, $detail, array('records' => isset($data['record']) ? $data['record'] : (isset($data['records']) ? $data['records'] : array())));
    }

    private function mapStatus($status)
    {
        $status = strtoupper($status);
        if (in_array($status, array('PASS', 'OK', 'VALID', 'CONFIGURED'), true)) {
            return 'PASS';
        }
        if (in_array($status, array('WARNING', 'PARTIAL'), true)) {
            return 'WARNING';
        }
        if (in_array($status, array('ERROR', 'FAIL', 'INVALID', 'MISSING'), true)) {
            return 'ERROR';
        }
        if (in_array($status, array('NOT_CHECKED', 'NOT CHECKED'), true)) {
            return 'NOT CHECKED';
        }
        return 'UNKNOWN';
    }

    private function check($key, $label, $status, $detail, array $evidence)
    {
        return array('key' => $key, 'label' => $label, 'status' => $status, 'detail' => $detail, 'evidence' => $evidence);
    }

    /**
     * The customer's own hosting context for this domain, read from the existing
     * WHMCS tables. Only the signed-in client's rows are read, and the section is
     * omitted entirely for a guest or an unowned domain.
     */
    private function hostingContext($domain)
    {
        $clientId = $this->clientId();
        if ($clientId <= 0 || !class_exists('WHMCS\\Database\\Capsule')) {
            return null;
        }
        try {
            $context = array('customer_id' => $clientId, 'domain' => $domain, 'owned' => false, 'hosting' => array(), 'note' => '');
            $domainRow = Capsule::table('tbldomains')->where('domain', $domain)->where('userid', $clientId)->first();
            if (!$domainRow) {
                $context['note'] = 'This domain is not registered to your CloudHost247 account. The report above used public data only.';
                return $context;
            }
            $context['owned'] = true;
            $context['registration_status'] = isset($domainRow->status) ? (string) $domainRow->status : '';
            $context['registration_date'] = isset($domainRow->registrationdate) ? (string) $domainRow->registrationdate : '';
            $context['next_due'] = isset($domainRow->nextduedate) ? (string) $domainRow->nextduedate : '';
            $context['registrar'] = isset($domainRow->registrar) ? (string) $domainRow->registrar : '';
            $hosting = Capsule::table('tblhosting')->where('userid', $clientId)->where('domain', $domain)->first();
            if ($hosting) {
                $context['hosting'] = array(
                    'service_id' => (int) $hosting->id,
                    'product_id' => (int) $hosting->packageid,
                    'status' => (string) $hosting->domainstatus,
                    'server_id' => (int) $hosting->server,
                    'dedicated_ip' => isset($hosting->dedicatedip) ? (string) $hosting->dedicatedip : '',
                    'assigned_ips' => isset($hosting->assignedips) ? (string) $hosting->assignedips : '',
                    'billing_cycle' => isset($hosting->billingcycle) ? (string) $hosting->billingcycle : '',
                    'next_due' => isset($hosting->nextduedate) ? (string) $hosting->nextduedate : '',
                );
            } else {
                $context['hosting'] = null;
                $context['note'] = 'The domain is on your account but no hosting service uses it as its primary domain. DNS, email and TLS above were checked from public data.';
            }
            return $context;
        } catch (\Throwable $unavailable) {
            return null;
        }
    }
}
