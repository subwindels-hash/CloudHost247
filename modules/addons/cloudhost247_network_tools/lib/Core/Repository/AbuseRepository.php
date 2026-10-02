<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Abuse detection (docs sections 25, 26, 68).
 *
 * A caller that repeatedly trips validation or rate limits against high-risk
 * tools (port checking, ping, traceroute, crawling) is recorded here, and the
 * runner applies the configured lockout window. The thresholds are settings,
 * not constants, so an administrator can tighten them without a code change.
 */
final class AbuseRepository extends Repository
{
    const TABLE = 'abuse_events';

    public function record($eventType, $ipAddress, $clientId, $toolSlug, $detail = '')
    {
        if (!$this->has(self::TABLE)) {
            return false;
        }
        try {
            $this->table(self::TABLE)->insert(array(
                'event_type' => substr((string) $eventType, 0, 48),
                'ip_address' => substr((string) $ipAddress, 0, 45),
                'client_id' => (int) $clientId,
                'tool_slug' => substr((string) $toolSlug, 0, 96),
                'detail' => substr((string) $detail, 0, 255),
                'created_at' => $this->now(),
            ));
            return true;
        } catch (\Throwable $unavailable) {
            return false;
        }
    }

    public function recentCount($ipAddress, $minutes = 15)
    {
        if (!$this->has(self::TABLE)) {
            return 0;
        }
        try {
            return (int) $this->table(self::TABLE)->where('ip_address', (string) $ipAddress)
                ->where('created_at', '>=', date('Y-m-d H:i:s', time() - max(1, (int) $minutes) * 60))->count();
        } catch (\Throwable $unavailable) {
            return 0;
        }
    }

    public function recent($limit = 100)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        try {
            return $this->table(self::TABLE)->orderBy('id', 'desc')->limit(max(1, (int) $limit))->get()->all();
        } catch (\Throwable $unavailable) {
            return array();
        }
    }
}
