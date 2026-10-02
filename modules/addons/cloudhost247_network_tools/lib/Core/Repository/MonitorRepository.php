<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Customer monitoring (docs sections 85-87): SSL expiry, DNS change and email
 * configuration monitoring, driven by the existing WHMCS/cPanel cron.
 */
final class MonitorRepository extends Repository
{
    const TABLE = 'monitors';
    const EVENTS = 'monitor_events';

    const TYPES = array('ssl_expiry', 'dns_change', 'email_config');

    public function create(array $data)
    {
        if (!$this->has(self::TABLE)) {
            return 0;
        }
        $this->table(self::TABLE)->insert(array(
            'client_id' => (int) $data['client_id'],
            'tool_slug' => substr((string) $data['tool_slug'], 0, 96),
            'monitor_type' => in_array($data['monitor_type'], self::TYPES, true) ? $data['monitor_type'] : 'dns_change',
            'target' => substr((string) $data['target'], 0, 191),
            'record_type' => substr((string) (isset($data['record_type']) ? $data['record_type'] : ''), 0, 16),
            'expected_json' => $this->encode(isset($data['expected']) ? (array) $data['expected'] : array()),
            'last_state_json' => null,
            'interval_hours' => max(1, min(168, (int) (isset($data['interval_hours']) ? $data['interval_hours'] : 6))),
            'enabled' => 1,
            'last_run_at' => null,
            'last_status' => 'NOT_CHECKED',
            'last_alert_at' => null,
            'created_at' => $this->now(),
            'updated_at' => $this->now(),
        ));
        return (int) $this->table(self::TABLE)->max('id');
    }

    public function all($clientId = null, $onlyEnabled = false)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        $query = $this->table(self::TABLE);
        if ($clientId !== null) {
            $query = $query->where('client_id', (int) $clientId);
        }
        if ($onlyEnabled) {
            $query = $query->where('enabled', 1);
        }
        return $query->orderBy('id', 'desc')->limit(500)->get()->all();
    }

    public function find($id)
    {
        if (!$this->has(self::TABLE)) {
            return null;
        }
        return $this->table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function due($limit = 25)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        $rows = $this->table(self::TABLE)->where('enabled', 1)->orderBy('last_run_at')->limit(max(1, (int) $limit))->get();
        $due = array();
        foreach ($rows as $row) {
            $last = $row->last_run_at ? strtotime((string) $row->last_run_at) : 0;
            if ($last === 0 || (time() - $last) >= ((int) $row->interval_hours * 3600)) {
                $due[] = $row;
            }
        }
        return $due;
    }

    public function setEnabled($clientId, $id, $enabled)
    {
        return (bool) $this->table(self::TABLE)->where('client_id', (int) $clientId)->where('id', (int) $id)
            ->update(array('enabled' => $enabled ? 1 : 0, 'updated_at' => $this->now()));
    }

    public function delete($clientId, $id)
    {
        return (bool) $this->table(self::TABLE)->where('client_id', (int) $clientId)->where('id', (int) $id)->delete();
    }

    public function record($id, $status, array $state, $alerted = false)
    {
        $this->table(self::TABLE)->update(array(
            'last_state_json' => $this->encode($state),
            'last_status' => substr((string) $status, 0, 32),
            'last_run_at' => $this->now(),
            'last_alert_at' => $alerted ? $this->now() : null,
            'updated_at' => $this->now(),
        ));
    }

    public function recordExpected($id, array $expected)
    {
        $this->table(self::TABLE)->update(array('expected_json' => $this->encode($expected), 'last_alert_at' => null, 'updated_at' => $this->now()));
    }

    public function addEvent($monitorId, $eventType, array $previous, array $current, $severity = 'warning')
    {
        if (!$this->has(self::EVENTS)) {
            return 0;
        }
        $this->table(self::EVENTS)->insert(array(
            'monitor_id' => (int) $monitorId,
            'event_type' => substr((string) $eventType, 0, 48),
            'previous_json' => $this->encode($previous),
            'current_json' => $this->encode($current),
            'severity' => substr((string) $severity, 0, 16),
            'notified' => 0,
            'created_at' => $this->now(),
        ));
        return (int) $this->table(self::EVENTS)->max('id');
    }

    public function events($monitorId, $limit = 25)
    {
        if (!$this->has(self::EVENTS)) {
            return array();
        }
        return $this->table(self::EVENTS)->where('monitor_id', (int) $monitorId)->orderBy('id', 'desc')->limit(max(1, (int) $limit))->get()->all();
    }

    public function markNotified($eventId)
    {
        $this->table(self::EVENTS)->where('id', (int) $eventId)->update(array('notified' => 1));
    }
}
