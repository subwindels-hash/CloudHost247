<?php
namespace DigitalProducts\Security;

use WHMCS\Database\Capsule;

final class RateLimiter
{
    public function hit($bucket, $identifier, $limit, $windowSeconds)
    {
        $bucket = substr(preg_replace('/[^a-z0-9_.-]/i', '_', (string) $bucket), 0, 191);
        $identifierHash = hash('sha256', (string) $identifier);
        $limit = max(1, (int) $limit);
        $windowSeconds = max(60, (int) $windowSeconds);
        $now = time();
        $windowStart = date('Y-m-d H:i:s', $now - ($now % $windowSeconds));
        $nowSql = date('Y-m-d H:i:s', $now);

        try {
            $row = Capsule::table('mod_digitalproducts_rate_limits')
                ->where('bucket', $bucket)
                ->where('identifier_hash', $identifierHash)
                ->first();
            if (!$row || (string) $row->window_start !== $windowStart) {
                Capsule::table('mod_digitalproducts_rate_limits')->updateOrInsert(
                    array('bucket' => $bucket, 'identifier_hash' => $identifierHash),
                    array('hits' => 1, 'window_start' => $windowStart, 'updated_at' => $nowSql)
                );
                return true;
            }
            if ((int) $row->hits >= $limit) { return false; }
            Capsule::table('mod_digitalproducts_rate_limits')
                ->where('id', $row->id)
                ->update(array('hits' => Capsule::raw('hits + 1'), 'updated_at' => $nowSql));
            return true;
        } catch (\Throwable $e) {
            // Prefer availability over false positives if the rate-limit table is
            // temporarily unavailable; other validation still applies.
            return true;
        }
    }
}
