<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Tool execution analytics (mod_cloudhost247_nt_executions =
 * tool_execution_logs) and the customer-facing history
 * (mod_cloudhost247_nt_history).
 *
 * Only metadata is ever written: tool, actor, target label, result code and
 * duration. Submitted credentials, pasted email content, scanned QR payloads
 * and passwords are never part of a log row — the runner only passes the
 * target label the tool declared as safe (see ToolDefinition::targetLabel()).
 */
final class ExecutionLogRepository extends Repository
{
    const TABLE = 'executions';
    const HISTORY_TABLE = 'history';

    public function record(array $row)
    {
        if (!$this->has(self::TABLE)) {
            return false;
        }
        try {
            $this->table(self::TABLE)->insert(array(
                'tool_slug' => substr((string) $row['tool_slug'], 0, 96),
                'category' => substr((string) $row['category'], 0, 32),
                'actor_type' => substr((string) $row['actor_type'], 0, 16),
                'client_id' => (int) $row['client_id'],
                'admin_id' => (int) $row['admin_id'],
                'ip_address' => substr((string) $row['ip_address'], 0, 45),
                'target_label' => substr((string) $row['target_label'], 0, 191),
                'result_code' => substr((string) $row['result_code'], 0, 48),
                'ok' => !empty($row['ok']) ? 1 : 0,
                'duration_ms' => (int) $row['duration_ms'],
                'cached' => !empty($row['cached']) ? 1 : 0,
                'provider_used' => substr((string) (isset($row['provider_used']) ? $row['provider_used'] : ''), 0, 64),
                'created_at' => $this->now(),
            ));
            return true;
        } catch (\Throwable $unavailable) {
            return false;
        }
    }

    public function historyRecord(array $row)
    {
        if (!$this->has(self::HISTORY_TABLE)) {
            return false;
        }
        try {
            $this->table(self::HISTORY_TABLE)->insert(array(
                'client_id' => (int) $row['client_id'],
                'tool_slug' => substr((string) $row['tool_slug'], 0, 96),
                'target_label' => substr((string) $row['target_label'], 0, 191),
                'result_code' => substr((string) $row['result_code'], 0, 48),
                'ok' => !empty($row['ok']) ? 1 : 0,
                'summary' => substr((string) $row['summary'], 0, 500),
                'created_at' => $this->now(),
            ));
            return true;
        } catch (\Throwable $unavailable) {
            return false;
        }
    }

    public function historyFor($clientId, $limit = 50)
    {
        if (!$this->has(self::HISTORY_TABLE)) {
            return array();
        }
        try {
            return $this->table(self::HISTORY_TABLE)->where('client_id', (int) $clientId)
                ->orderBy('id', 'desc')->limit(max(1, min(200, (int) $limit)))->get()->all();
        } catch (\Throwable $unavailable) {
            return array();
        }
    }

    public function clearHistory($clientId)
    {
        if (!$this->has(self::HISTORY_TABLE)) {
            return 0;
        }
        return (int) $this->table(self::HISTORY_TABLE)->where('client_id', (int) $clientId)->delete();
    }

    public function metrics($sinceDays = 30)
    {
        $metrics = array(
            'total' => 0, 'today' => 0, 'failed' => 0, 'failed_today' => 0,
            'cached' => 0, 'avg_duration_ms' => 0, 'by_tool' => array(), 'by_day' => array(),
            'rate_limit_events' => 0, 'abuse_events' => 0,
        );
        if (!$this->has(self::TABLE)) {
            return $metrics;
        }
        try {
            $since = date('Y-m-d H:i:s', time() - max(1, (int) $sinceDays) * 86400);
            $rows = $this->table(self::TABLE)->where('created_at', '>=', $since)->get();
            $totalDuration = 0;
            $today = date('Y-m-d');
            foreach ($rows as $row) {
                $metrics['total']++;
                $totalDuration += (int) $row->duration_ms;
                if (substr((string) $row->created_at, 0, 10) === $today) {
                    $metrics['today']++;
                }
                if (!$row->ok) {
                    $metrics['failed']++;
                    if (substr((string) $row->created_at, 0, 10) === $today) {
                        $metrics['failed_today']++;
                    }
                }
                if ($row->cached) {
                    $metrics['cached']++;
                }
                if ($row->result_code === 'RATE_LIMITED') {
                    $metrics['rate_limit_events']++;
                }
                $slug = (string) $row->tool_slug;
                $metrics['by_tool'][$slug] = isset($metrics['by_tool'][$slug]) ? $metrics['by_tool'][$slug] + 1 : 1;
                $day = substr((string) $row->created_at, 0, 10);
                $metrics['by_day'][$day] = isset($metrics['by_day'][$day]) ? $metrics['by_day'][$day] + 1 : 1;
            }
            $metrics['avg_duration_ms'] = $metrics['total'] > 0 ? (int) round($totalDuration / $metrics['total']) : 0;
            arsort($metrics['by_tool']);
            ksort($metrics['by_day']);
        } catch (\Throwable $unavailable) {
            // Return the zeroed shape; the admin dashboard reports the outage.
        }
        return $metrics;
    }

    public function recent($limit = 100)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        try {
            return $this->table(self::TABLE)->orderBy('id', 'desc')->limit(max(1, min(500, (int) $limit)))->get()->all();
        } catch (\Throwable $unavailable) {
            return array();
        }
    }

    public function prune($retentionDays)
    {
        $retentionDays = max(1, (int) $retentionDays);
        if (!$this->has(self::TABLE)) {
            return 0;
        }
        return (int) $this->table(self::TABLE)->where('created_at', '<', date('Y-m-d H:i:s', time() - $retentionDays * 86400))->delete();
    }
}
