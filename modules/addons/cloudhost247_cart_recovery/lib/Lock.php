<?php
/**
 * Database-backed advisory lock for cron/worker runs.
 *
 * The settings table stores a lease expiry; acquisition is a conditional
 * UPDATE, so two overlapping cron processes (or a manual admin run happening
 * at the same time) can never both process the same reminders. A crashed run
 * releases the lock automatically when the lease expires.
 */

namespace CloudHost247\CartRecovery;

use WHMCS\Database\Capsule;

final class Lock
{
    /** @var string|null owner id of the lock currently held by this process */
    private static $owner = null;

    public static function acquire($name = 'cron', $ttl = null)
    {
        $ttl = $ttl === null ? SettingsRepository::int('lock_ttl') : (int) $ttl;
        $ttl = max(30, $ttl);
        $key = 'lock:' . $name;
        $now = time();
        $owner = bin2hex(random_bytes(8));
        $lease = date('Y-m-d H:i:s', $now + $ttl) . '|' . $owner;

        $row = Capsule::table(Schema::SETTINGS)->where('setting', $key)->first();
        if (!$row) {
            try {
                Capsule::table(Schema::SETTINGS)->insert(array('setting' => $key, 'value' => $lease, 'updated_at' => date('Y-m-d H:i:s')));
                self::$owner = $owner;
                return true;
            } catch (\Throwable $e) {
                // Lost the insert race against another worker.
                return false;
            }
        }
        $current = (string) $row->value;
        $expiry = strtotime(substr($current, 0, 19));
        if ($expiry !== false && $expiry > $now) {
            return false;
        }
        // Conditional take-over: only the process that still sees the stale
        // lease value wins.
        $affected = Capsule::table(Schema::SETTINGS)
            ->where('setting', $key)
            ->where('value', $current)
            ->update(array('value' => $lease, 'updated_at' => date('Y-m-d H:i:s')));
        if ($affected) {
            self::$owner = $owner;
            return true;
        }
        return false;
    }

    public static function release($name = 'cron')
    {
        if (self::$owner === null) {
            return false;
        }
        $key = 'lock:' . $name;
        $owner = self::$owner;
        self::$owner = null;
        $row = Capsule::table(Schema::SETTINGS)->where('setting', $key)->first();
        if (!$row || substr((string) $row->value, -strlen($owner)) !== $owner) {
            return false;
        }
        Capsule::table(Schema::SETTINGS)->where('setting', $key)->update(array(
            'value' => date('Y-m-d H:i:s', time() - 1) . '|released',
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        return true;
    }

    public static function heldBy()
    {
        return self::$owner;
    }
}
