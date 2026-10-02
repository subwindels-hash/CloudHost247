<?php
namespace CloudHost247\NetworkTools\Services\Shared;

use CloudHost247\NetworkTools\Core\Repository\MonitorRepository;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Dns\ResolverPool;
use CloudHost247\NetworkTools\Core\Repository\ResolverRepository;
use CloudHost247\NetworkTools\Services\Dns\DkimService;
use CloudHost247\NetworkTools\Services\Dns\DmarcService;
use CloudHost247\NetworkTools\Services\Dns\SpfService;
use CloudHost247\NetworkTools\Services\Security\SslService;
use WHMCS\Database\Capsule;

/**
 * Monitoring engine (docs sections 80, 81).
 *
 * Runs one check per monitor and compares the observation with the state that
 * was recorded at the previous run. A check that could not run is recorded as
 * NOT_CHECKED and never as "unchanged": an outage in the monitoring path must
 * never look like good news. Changes produce an event and, for a customer
 * monitor, a notification through the platform's existing email system.
 */
final class MonitorRunner
{
    /** @var MonitorRepository */
    private $monitors;
    /** @var SettingsRepository */
    private $settings;

    public function __construct(MonitorRepository $monitors = null, SettingsRepository $settings = null)
    {
        $this->monitors = $monitors ?: new MonitorRepository();
        $this->settings = $settings ?: new SettingsRepository();
    }

    /** @return array{checked:int,changed:int,failed:int,unknown:int,skipped:string} */
    public function runDue($limit = 25)
    {
        if (!$this->settings->bool('enabled') || !$this->settings->bool('monitoring_enabled')) {
            return array('checked' => 0, 'changed' => 0, 'failed' => 0, 'unknown' => 0, 'skipped' => 'Monitoring is disabled in the module settings.');
        }
        $checked = 0;
        $changed = 0;
        $failed = 0;
        $unknown = 0;
        foreach ($this->monitors->due($limit) as $monitor) {
            $result = $this->runMonitor($monitor);
            $checked++;
            if ($result['changed']) {
                $changed++;
            }
            if ($result['status'] === 'FAILED') {
                $failed++;
            }
            if ($result['status'] === 'NOT_CHECKED') {
                $unknown++;
            }
        }
        return array('checked' => $checked, 'changed' => $changed, 'failed' => $failed, 'unknown' => $unknown, 'skipped' => '');
    }

    /**
     * @return array{status:string,changed:bool,state:array,detail:string,alerted:bool}
     */
    public function runMonitor($monitor)
    {
        $id = (int) $monitor->id;
        $type = (string) $monitor->monitor_type;
        try {
            if ($type === 'ssl_expiry') {
                $observation = $this->checkSsl($monitor);
            } elseif ($type === 'email_config') {
                $observation = $this->checkEmail($monitor);
            } else {
                $observation = $this->checkDns($monitor);
            }
        } catch (\Throwable $failure) {
            $observation = array('status' => 'NOT_CHECKED', 'state' => array(), 'detail' => 'The check could not run (' . get_class($failure) . '). It is recorded as not checked, not as unchanged.');
        }
        $status = $observation['status'];
        $state = $observation['state'];
        $previous = json_decode((string) $monitor->last_state_json, true);
        $previous = is_array($previous) ? $previous : array();
        $changed = false;
        $detail = isset($observation['detail']) ? (string) $observation['detail'] : '';
        if ($status === 'OK' && $previous) {
            $differences = $this->differences($previous, $state);
            if ($differences) {
                $changed = true;
                $detail = 'Changed: ' . implode('; ', array_slice($differences, 0, 6));
                $this->monitors->addEvent($id, $type . '.changed', $previous, $state, 'warning');
            }
        } elseif ($status === 'OK' && !$previous) {
            $detail = 'First observation recorded as the baseline for future comparisons.';
        }
        $alerted = false;
        if ($changed) {
            $alerted = $this->notify($monitor, $detail);
        }
        if ($status === 'OK') {
            $this->monitors->record($id, $changed ? 'CHANGED' : 'OK', $state, $alerted);
        } else {
            // Keep the last good state so a transient failure does not wipe the
            // baseline, but never report the monitor as healthy.
            $this->monitors->record($id, $status, $previous, false);
        }
        return array('status' => $status, 'changed' => $changed, 'state' => $state, 'detail' => $detail, 'alerted' => $alerted);
    }

    private function checkDns($monitor)
    {
        $target = trim((string) $monitor->target);
        $parts = preg_split('/\s+/', $target);
        $domain = isset($parts[0]) ? $parts[0] : '';
        $type = isset($parts[1]) ? strtoupper($parts[1]) : (string) $monitor->record_type;
        $type = $type !== '' ? $type : 'A';
        if (!in_array($type, array('A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA', 'SOA', 'SRV', 'PTR'), true)) {
            return array('status' => 'NOT_CHECKED', 'state' => array(), 'detail' => 'Unsupported record type "' . $type . '" for a monitor.');
        }
        $pool = new ResolverPool(new ResolverRepository(), array('dns_timeout_seconds' => max(2, $this->settings->int('dns_timeout_seconds', 5)), 'dns_retries' => 1));
        $response = $pool->defaultClient()->query($domain, $type);
        if (!$response['ok']) {
            return array('status' => 'NOT_CHECKED', 'state' => array(), 'detail' => 'The DNS query failed: ' . (isset($response['error']) ? $response['error'] : 'unknown reason') . '.');
        }
        $values = DnsClient::values($response['records'], $type);
        $state = array('domain' => $domain, 'type' => $type, 'values' => $values, 'checked_at' => gmdate('c'));
        $expected = json_decode((string) $monitor->expected_json, true);
        $expectedValue = is_array($expected) && isset($expected['value']) ? trim((string) $expected['value']) : '';
        if ($expectedValue !== '') {
            $matched = false;
            foreach ($values as $value) {
                if (strcasecmp(trim($value, '"'), $expectedValue) === 0 || stripos($value, $expectedValue) !== false) {
                    $matched = true;
                    break;
                }
            }
            $state['expected'] = $expectedValue;
            $state['expected_matched'] = $matched;
            if (!$matched) {
                return array('status' => 'FAILED', 'state' => $state, 'detail' => 'The observed ' . $type . ' records do not match the expected value "' . $expectedValue . '".');
            }
        }
        return array('status' => 'OK', 'state' => $state, 'detail' => count($values) . ' ' . $type . ' record(s) observed.');
    }

    private function checkSsl($monitor)
    {
        $host = trim((string) $monitor->target);
        $service = new SslService();
        $result = $service->run(array('host' => $host, 'port' => 443), array('settings' => $this->settings->all()));
        if (!$result->isOk()) {
            return array('status' => 'NOT_CHECKED', 'state' => array(), 'detail' => 'The certificate check failed: ' . $result->message());
        }
        $data = $result->data();
        $days = isset($data['days_remaining']) ? (int) $data['days_remaining'] : null;
        $state = array(
            'host' => $host,
            'valid_to' => isset($data['valid_to']) ? $data['valid_to'] : '',
            'days_remaining' => $days,
            'issuer' => isset($data['issuer']['organization']) ? $data['issuer']['organization'] : '',
            'verified' => !empty($data['verification']['verified']),
            'checked_at' => gmdate('c'),
        );
        if ($days === null) {
            return array('status' => 'NOT_CHECKED', 'state' => $state, 'detail' => 'The certificate expiry could not be read.');
        }
        if ($days < 0) {
            return array('status' => 'FAILED', 'state' => $state, 'detail' => 'The certificate expired ' . abs($days) . ' day(s) ago.');
        }
        $intervals = array_filter(array_map('intval', explode(',', (string) $this->settings->get('ssl_monitor_intervals', '30,14,7,3,1'))));
        sort($intervals);
        foreach ($intervals as $threshold) {
            if ($days <= $threshold) {
                return array('status' => 'OK', 'state' => $state, 'detail' => 'The certificate expires in ' . $days . ' day(s) (threshold ' . $threshold . ' days reached).');
            }
        }
        return array('status' => 'OK', 'state' => $state, 'detail' => 'The certificate is valid for ' . $days . ' more day(s).');
    }

    private function checkEmail($monitor)
    {
        $domain = trim((string) $monitor->target);
        $expected = json_decode((string) $monitor->expected_json, true);
        $selector = is_array($expected) && !empty($expected['dkim_selector']) ? (string) $expected['dkim_selector'] : 'default';
        $context = array('settings' => $this->settings->all());
        $spf = (new SpfService())->run(array('domain' => $domain), $context);
        $dmarc = (new DmarcService())->run(array('domain' => $domain), $context);
        $dkim = (new DkimService())->run(array('domain' => $domain, 'selectors' => $selector), $context);
        $state = array(
            'domain' => $domain,
            'spf' => $spf->isOk() ? $this->emailFingerprint($spf->data()) : 'CHECK_FAILED',
            'dmarc' => $dmarc->isOk() ? $this->emailFingerprint($dmarc->data()) : 'CHECK_FAILED',
            'dkim_selector' => $selector,
            'dkim' => $dkim->isOk() ? $this->emailFingerprint($dkim->data()) : 'CHECK_FAILED',
            'checked_at' => gmdate('c'),
        );
        $failed = array();
        foreach (array('spf', 'dmarc', 'dkim') as $part) {
            if ($state[$part] === 'CHECK_FAILED') {
                $failed[] = $part;
            }
        }
        if ($failed) {
            return array('status' => 'NOT_CHECKED', 'state' => $state, 'detail' => 'These checks could not run: ' . implode(', ', $failed) . '.');
        }
        return array('status' => 'OK', 'state' => $state, 'detail' => 'SPF, DMARC and DKIM were checked and recorded.');
    }

    /** Compare only the fields that matter, so volatile timestamps do not alert. */
    private function emailFingerprint(array $data)
    {
        $fingerprint = array();
        foreach (array('records', 'record', 'status', 'policy', 'valid', 'summary') as $key) {
            if (array_key_exists($key, $data)) {
                $fingerprint[$key] = is_scalar($data[$key]) ? (string) $data[$key] : md5(json_encode($data[$key]));
            }
        }
        if (!$fingerprint) {
            $fingerprint['digest'] = md5(json_encode($data));
        }
        return $fingerprint;
    }

    private function differences(array $previous, array $current, $prefix = '')
    {
        $differences = array();
        foreach ($current as $key => $value) {
            if (in_array($key, array('checked_at'), true)) {
                continue;
            }
            if (!array_key_exists($key, $previous)) {
                $differences[] = $prefix . $key . ' is newly present';
                continue;
            }
            if (is_array($value) || is_array($previous[$key])) {
                if (json_encode($value) !== json_encode($previous[$key])) {
                    $differences[] = $prefix . $key . ' changed';
                }
                continue;
            }
            if ((string) $value !== (string) $previous[$key]) {
                $differences[] = $prefix . $key . ': "' . $this->short($previous[$key]) . '" → "' . $this->short($value) . '"';
            }
        }
        foreach ($previous as $key => $value) {
            if ($key === 'checked_at' || array_key_exists($key, $current)) {
                continue;
            }
            $differences[] = $prefix . $key . ' is no longer present';
        }
        return $differences;
    }

    private function short($value)
    {
        $value = (string) $value;
        return strlen($value) > 60 ? substr($value, 0, 57) . '…' : $value;
    }

    /** Notify through the existing WHMCS email system, never a custom mailer. */
    private function notify($monitor, $detail)
    {
        $clientId = (int) $monitor->client_id;
        if ($clientId <= 0 || !function_exists('localAPI')) {
            return false;
        }
        try {
            $subject = 'CloudHost247 monitor alert: ' . (string) $monitor->target . ' changed';
            $body = "A monitor you created in CloudHost247 Network Tools detected a change.\n\n"
                . 'Monitor: ' . (string) $monitor->monitor_type . ' for ' . (string) $monitor->target . "\n"
                . 'Detected: ' . gmdate('c') . "\n\n"
                . $detail . "\n\n"
                . "Review it at /tools and choose Diagnostics → Domain Monitoring.\n"
                . 'You are receiving this because you created a monitor on this account.';
            localAPI('SendEmail', array(
                'id' => $clientId,
                'customtype' => 'general',
                'customsubject' => $subject,
                'custommessage' => $body,
            ));
            return true;
        } catch (\Throwable $unavailable) {
            // A notification failure must not lose the recorded change.
            return false;
        }
    }
}
