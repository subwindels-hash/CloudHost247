<?php
namespace CloudHost247\NetworkTools\Services\Context;

use CloudHost247\NetworkTools\Core\Repository\MonitorRepository;
use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use CloudHost247\NetworkTools\Services\Service;
use CloudHost247\NetworkTools\Services\Shared\MonitorRunner;
use InvalidArgumentException;

/**
 * Domain monitoring (docs section 81).
 *
 * Customer-facing CRUD over the monitor registry plus an on-demand check. The
 * service only ever touches monitors that belong to the signed-in client; the
 * repository filters by client id and this class refuses to act for a guest.
 * Monitors run on the WHMCS cron through MonitorRunner, which does the real
 * check and notification.
 */
final class MonitorService extends Service
{
    protected function execute()
    {
        $clientId = $this->clientId();
        if ($clientId <= 0) {
            return ToolResult::failure('AUTH_REQUIRED', 'Sign in to manage domain monitors.');
        }
        $repository = new MonitorRepository();
        $action = isset($this->input['action']) ? $this->input['action'] : 'list';
        if ($action === 'create') {
            return $this->create($repository, $clientId);
        }
        if ($action === 'delete') {
            $id = (int) (isset($this->input['monitor_id']) ? $this->input['monitor_id'] : 0);
            if ($id <= 0) {
                throw new InvalidArgumentException('Enter the ID of the monitor you want to delete.');
            }
            $monitor = $repository->find($id);
            if (!$monitor || (int) $monitor->client_id !== $clientId) {
                throw new InvalidArgumentException('That monitor does not exist on this account.');
            }
            $repository->delete($clientId, $id);
            return ToolResult::success(array(
                'action' => 'delete',
                'deleted' => $id,
                'summary' => 'Monitor ' . $id . ' deleted.',
            ));
        }
        if ($action === 'check') {
            $id = (int) (isset($this->input['monitor_id']) ? $this->input['monitor_id'] : 0);
            $monitor = $id > 0 ? $repository->find($id) : null;
            if (!$monitor || (int) $monitor->client_id !== $clientId) {
                throw new InvalidArgumentException('That monitor does not exist on this account.');
            }
            $runner = new MonitorRunner($repository);
            $result = $runner->runMonitor($monitor);
            return ToolResult::success(array(
                'action' => 'check',
                'monitor_id' => $id,
                'status' => $result['status'],
                'changed' => $result['changed'],
                'detail' => $result['detail'],
                'state' => $result['state'],
                'summary' => 'Monitor ' . $id . ' checked: ' . $result['status'] . ($result['changed'] ? ' (change detected)' : '') . '.',
            ));
        }
        return $this->listMonitors($repository, $clientId);
    }

    private function create($repository, $clientId)
    {
        $type = isset($this->input['monitor_type']) ? $this->input['monitor_type'] : 'dns_change';
        if (!in_array($type, MonitorRepository::TYPES, true)) {
            throw new InvalidArgumentException('Choose one of the monitor types: DNS record change, SSL certificate expiry or email authentication configuration.');
        }
        $rawTarget = trim((string) (isset($this->input['target']) ? $this->input['target'] : ''));
        if ($rawTarget === '') {
            throw new InvalidArgumentException('Enter a domain' . ($type === 'dns_change' ? ' and, optionally, a record type such as "example.com A"' : '') . '.');
        }
        $recordType = '';
        $domain = $rawTarget;
        if ($type === 'dns_change') {
            $parts = preg_split('/\s+/', $rawTarget);
            $domain = $parts[0];
            $recordType = isset($parts[1]) ? strtoupper($parts[1]) : 'A';
            if (!in_array($recordType, array('A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA', 'SOA', 'SRV', 'PTR'), true)) {
                throw new InvalidArgumentException('That record type cannot be monitored. Supported: A, AAAA, CNAME, MX, NS, TXT, CAA, SOA, SRV, PTR.');
            }
        }
        $domain = TargetValidator::domain($domain, 'monitor domain');
        $expected = array();
        $expectedValue = trim((string) (isset($this->input['expected']) ? $this->input['expected'] : ''));
        if ($expectedValue !== '') {
            $expected['value'] = $expectedValue;
        }
        $interval = isset($this->input['interval_hours']) ? (int) $this->input['interval_hours'] : 6;
        $id = $repository->create(array(
            'client_id' => $clientId,
            'tool_slug' => 'diagnostics/monitors',
            'monitor_type' => $type,
            'target' => $domain,
            'record_type' => $recordType,
            'expected' => $expected,
            'interval_hours' => $interval,
        ));
        if ($id <= 0) {
            return ToolResult::failure('SERVICE_UNAVAILABLE', 'The monitor could not be saved. Please try again shortly.');
        }
        $warnings = array();
        if ($type === 'ssl_expiry' || $type === 'email_config') {
            $warnings[] = 'The first check runs on the next WHMCS cron pass, so the baseline has not been recorded yet.';
        }
        return ToolResult::success(array(
            'action' => 'create',
            'monitor_id' => $id,
            'monitor_type' => $type,
            'target' => $domain . ($recordType !== '' ? ' ' . $recordType : ''),
            'interval_hours' => max(1, min(168, $interval)),
            'expected' => $expected,
            'summary' => 'Monitor ' . $id . ' created for ' . $domain . '. It runs on the WHMCS cron every ' . max(1, min(168, $interval)) . ' hour(s).',
            'notification_note' => 'When a change is detected the platform emails you through the same system that sends your CloudHost247 service messages.',
        ), $warnings);
    }

    private function listMonitors($repository, $clientId)
    {
        $rows = $repository->all($clientId);
        $items = array();
        foreach ($rows as $row) {
            $items[] = array(
                'id' => (int) $row->id,
                'monitor_type' => (string) $row->monitor_type,
                'target' => (string) $row->target . ((string) $row->record_type !== '' ? ' ' . (string) $row->record_type : ''),
                'interval_hours' => (int) $row->interval_hours,
                'enabled' => (int) $row->enabled === 1,
                'last_status' => (string) $row->last_status,
                'last_run_at' => (string) $row->last_run_at,
                'last_alert_at' => (string) $row->last_alert_at,
                'expected' => (string) $row->expected_json,
            );
        }
        return ToolResult::success(array(
            'action' => 'list',
            'monitors' => $items,
            'count' => count($items),
            'summary' => count($items) . ' monitor(s). Monitors are checked by the WHMCS cron; a check that could not run is reported as NOT_CHECKED, never as unchanged.',
            'limits' => 'A monitor only ever reads the public DNS, TLS or email configuration of the domain you entered. It cannot see anything beyond what any resolver or client could see.',
        ));
    }
}
