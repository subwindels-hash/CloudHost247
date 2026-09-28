<?php
/**
 * Persistent cooperative locks (mod_hostx_email_locks).
 *
 * Prevents cron, webhook and admin-initiated work from touching the same
 * service - or the same provider tenant - concurrently. Locks always carry an
 * expiry so a crashed process cannot wedge the module permanently.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Support;

use WHMCS\Database\Capsule;

final class Lock
{
    const TABLE = 'mod_hostx_email_locks';

    /** @var array<int,string> keys held by this process */
    private static $held = [];

    /**
     * Try to acquire a lock. Returns false when somebody else holds it.
     */
    public static function acquire(string $key, int $ttlSeconds = 120): bool
    {
        $key = substr($key, 0, 191);
        $now = date('Y-m-d H:i:s');
        $expires = date('Y-m-d H:i:s', time() + max(5, $ttlSeconds));
        $owner = substr(Logger::correlationId(), 0, 64);

        try {
            // Reap expired locks first; harmless if another process beats us.
            Capsule::table(self::TABLE)->where('expires_at', '<', $now)->delete();

            Capsule::table(self::TABLE)->insert([
                'lock_key'    => $key,
                'owner'       => $owner,
                'acquired_at' => $now,
                'expires_at'  => $expires,
            ]);

            self::$held[] = $key;

            return true;
        } catch (\Throwable $e) {
            // Primary key violation = somebody holds it.
            return false;
        }
    }

    public static function release(string $key): void
    {
        $key = substr($key, 0, 191);

        try {
            Capsule::table(self::TABLE)->where('lock_key', $key)->delete();
        } catch (\Throwable $e) {
            Logger::debug('lock.release_failed', ['lock' => $key, 'error' => $e->getMessage()]);
        }

        self::$held = array_values(array_filter(self::$held, static function ($held) use ($key) {
            return $held !== $key;
        }));
    }

    /**
     * Run a callback under a lock.
     *
     * @param  callable $callback
     * @return array<string,mixed> Result envelope; CODE_CONFLICT when busy
     */
    public static function withLock(string $key, int $ttlSeconds, callable $callback): array
    {
        if (!self::acquire($key, $ttlSeconds)) {
            return Result::fail(
                Result::CODE_CONFLICT,
                'Another operation for this service is already running. Please try again shortly.'
            );
        }

        try {
            return $callback();
        } finally {
            self::release($key);
        }
    }

    public static function serviceKey(int $serviceId): string
    {
        return 'service:' . $serviceId;
    }

    public static function releaseAllHeld(): void
    {
        foreach (self::$held as $key) {
            self::release($key);
        }
    }
}
