<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Provider and resolver health history (tool_health_checks).
 */
final class HealthRepository extends Repository
{
    const TABLE = 'health';

    public function record($subjectType, $subjectKey, $status, $latencyMs = null, $detail = '')
    {
        if (!$this->has(self::TABLE)) {
            return false;
        }
        try {
            $this->table(self::TABLE)->insert(array(
                'subject_type' => substr((string) $subjectType, 0, 24),
                'subject_key' => substr((string) $subjectKey, 0, 128),
                'status' => substr((string) $status, 0, 32),
                'latency_ms' => $latencyMs === null ? null : (int) $latencyMs,
                'detail' => substr((string) $detail, 0, 500),
                'checked_at' => $this->now(),
            ));
            if (random_int(1, 30) === 1) {
                $this->table(self::TABLE)->where('checked_at', '<', date('Y-m-d H:i:s', time() - 30 * 86400))->delete();
            }
            return true;
        } catch (\Throwable $unavailable) {
            return false;
        }
    }

    /** Latest row per subject plus the 24h error rate. */
    public function summary($subjectType = null)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        $since = date('Y-m-d H:i:s', time() - 86400);
        $query = $this->table(self::TABLE)->where('checked_at', '>=', $since);
        if ($subjectType !== null) {
            $query = $query->where('subject_type', (string) $subjectType);
        }
        $summary = array();
        foreach ($query->orderBy('id')->get() as $row) {
            $key = $row->subject_key;
            if (!isset($summary[$key])) {
                $summary[$key] = array('subject_type' => $row->subject_type, 'checks' => 0, 'failures' => 0, 'last_status' => $row->status,
                    'last_checked_at' => $row->checked_at, 'last_latency_ms' => $row->latency_ms, 'last_detail' => $row->detail);
            }
            $summary[$key]['checks']++;
            if (!in_array($row->status, array('AVAILABLE', 'CONNECTED', 'SUCCESS', 'OK'), true)) {
                $summary[$key]['failures']++;
            }
            $summary[$key]['last_status'] = $row->status;
            $summary[$key]['last_checked_at'] = $row->checked_at;
            $summary[$key]['last_latency_ms'] = $row->latency_ms;
            $summary[$key]['last_detail'] = $row->detail;
        }
        foreach ($summary as $key => $row) {
            $summary[$key]['error_rate'] = $row['checks'] > 0 ? round($row['failures'] / $row['checks'] * 100, 1) : 0;
        }
        return $summary;
    }
}
