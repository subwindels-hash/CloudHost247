<?php
namespace CloudHost247\NetworkTools\Core\Repository;

use WHMCS\Database\Capsule;

/**
 * Fixed-window counters (mod_cloudhost247_nt_rate_limits).
 *
 * One row per (dimension, bucket, window start). Expired rows are pruned
 * opportunistically rather than by a cron, so a deployment that never enables
 * tools does not accumulate state.
 */
final class RateLimitRepository
{
    const TABLE = 'mod_cloudhost247_nt_rate_limits';

    public function hit($dimension, $bucket, $window)
    {
        $window = max(1, (int) $window);
        $windowStart = time() - (time() % $window);
        $key = $this->key($bucket);
        try {
            $row = Capsule::table(self::TABLE)->where('dimension', (string) $dimension)->where('bucket', $key)
                ->where('window_start', $windowStart)->first();
            if ($row) {
                Capsule::table(self::TABLE)->where('id', $row->id)->update(array('counter' => (int) $row->counter + 1));
                return (int) $row->counter + 1;
            }
            Capsule::table(self::TABLE)->insert(array(
                'dimension' => substr((string) $dimension, 0, 32), 'bucket' => $key, 'window_start' => $windowStart,
                'counter' => 1, 'created_at' => date('Y-m-d H:i:s'),
            ));
            if (random_int(1, 50) === 1) {
                Capsule::table(self::TABLE)->where('window_start', '<', time() - 86400)->delete();
            }
            return 1;
        } catch (\Throwable $unavailable) {
            // Never fail closed on infrastructure trouble: the tool runner
            // records the failure and the operation continues, rate limits
            // resume as soon as the table is reachable again.
            return 0;
        }
    }

    public function secondsUntilReset($dimension, $bucket, $window)
    {
        $window = max(1, (int) $window);
        $elapsed = time() % $window;
        return max(1, $window - $elapsed);
    }

    public function usage($dimension, $bucket, $window)
    {
        $windowStart = time() - (time() % max(1, (int) $window));
        $row = Capsule::table(self::TABLE)->where('dimension', (string) $dimension)->where('bucket', $this->key($bucket))
            ->where('window_start', $windowStart)->first();
        return $row ? (int) $row->counter : 0;
    }

    private function key($bucket)
    {
        return substr((string) $bucket, 0, 128);
    }
}
