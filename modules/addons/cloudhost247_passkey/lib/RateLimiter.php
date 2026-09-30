<?php
/**
 * Rate limiting and temporary lockout (spec §31).
 *
 * Counts failures per (bucket, subject) pair inside a sliding window and
 * applies a *temporary* lockout — never a permanent one, so a transient
 * problem can never lock a customer out of their account forever. Successful
 * ceremonies clear the counter.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class RateLimiter
{
    /**
     * @throws PasskeyException when the caller is currently locked out
     */
    public static function assert($bucket, $subject)
    {
        $row = self::row($bucket, $subject);
        if (!$row) {
            return true;
        }
        if ($row['locked_until'] && strtotime((string) $row['locked_until']) > time()) {
            throw new PasskeyException('Too many attempts. Please wait before trying again.', 'rate_limited');
        }
        return true;
    }

    /** Records a failure and locks the bucket once the threshold is crossed. */
    public static function fail($bucket, $subject)
    {
        $window = max(60, SettingsRepository::int('rate_limit_window'));
        $limit = max(3, SettingsRepository::int('rate_limit_attempts'));
        $lockout = max(60, SettingsRepository::int('lockout_seconds'));
        $now = time();
        $key = self::key($bucket, $subject);

        $row = self::row($bucket, $subject);
        if (!$row) {
            Capsule::table(Schema::RATE_LIMITS)->insert(array(
                'bucket' => mb_substr((string) $bucket, 0, 32),
                'subject_hash' => $key,
                'attempts' => 1,
                'window_started_at' => date('Y-m-d H:i:s', $now),
                'locked_until' => null,
                'updated_at' => date('Y-m-d H:i:s', $now),
            ));
            return 1;
        }

        $windowStart = strtotime((string) $row['window_started_at']);
        $attempts = ($windowStart + $window < $now) ? 1 : ((int) $row['attempts'] + 1);
        $update = array(
            'attempts' => $attempts,
            'window_started_at' => ($attempts === 1) ? date('Y-m-d H:i:s', $now) : $row['window_started_at'],
            'updated_at' => date('Y-m-d H:i:s', $now),
            'locked_until' => null,
        );
        if ($attempts >= $limit) {
            $update['locked_until'] = date('Y-m-d H:i:s', $now + $lockout);
        }
        Capsule::table(Schema::RATE_LIMITS)->where('subject_hash', $key)->update($update);
        return $attempts;
    }

    public static function clear($bucket, $subject)
    {
        Capsule::table(Schema::RATE_LIMITS)->where('subject_hash', self::key($bucket, $subject))->delete();
    }

    /** Housekeeping for the cron: drop windows that are long finished. */
    public static function prune()
    {
        return (int) Capsule::table(Schema::RATE_LIMITS)
            ->where('updated_at', '<', date('Y-m-d H:i:s', time() - 86400))
            ->delete();
    }

    private static function row($bucket, $subject)
    {
        $row = Capsule::table(Schema::RATE_LIMITS)->where('subject_hash', self::key($bucket, $subject))->first();
        return $row ? (array) $row : null;
    }

    /** Subjects (emails, ip addresses, user ids) are hashed, never stored raw. */
    private static function key($bucket, $subject)
    {
        return hash('sha256', 'cloudhost247-passkey-rl:' . $bucket . ':' . strtolower((string) $subject));
    }
}
