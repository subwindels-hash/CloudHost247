<?php
namespace CloudHost247\Smm\Services;

use WHMCS\Database\Capsule;

/**
 * Database-backed execution lock (same semantics as the currency module's):
 * a lock row is owned by a random token; stale locks (locked_until in the
 * past) may be taken over so a crashed run can never deadlock the automation.
 */
final class ExecutionLock
{
    const TABLE = 'mod_cloudhost247_smm_locks';

    private $name;
    private $owner;
    private $held = false;

    public function __construct($name)
    {
        $this->name = mb_substr(preg_replace('/[^A-Za-z0-9_.-]/', '', (string) $name), 0, 64);
        $this->owner = bin2hex(random_bytes(16));
    }

    /** @return bool true when this instance owns the lock */
    public function acquire($minutes = 10)
    {
        $now = time();
        $until = date('Y-m-d H:i:s', $now + 60 * max(1, (int) $minutes));
        try {
            $existing = Capsule::table(self::TABLE)->where('lock_name', $this->name)->first();
            if ($existing === null) {
                $inserted = Capsule::table(self::TABLE)->insert(array(
                    'lock_name' => $this->name,
                    'owner' => $this->owner,
                    'locked_until' => $until,
                    'updated_at' => date('Y-m-d H:i:s', $now),
                ));
                $this->held = (bool) $inserted;
                return $this->held;
            }
            if (strtotime((string) $existing->locked_until) > $now) {
                $this->held = false;
                return false;
            }
            // takeover of a stale lock
            $taken = Capsule::table(self::TABLE)
                ->where('lock_name', $this->name)
                ->where('locked_until', (string) $existing->locked_until)
                ->update(array('owner' => $this->owner, 'locked_until' => $until, 'updated_at' => date('Y-m-d H:i:s', $now)));
            $this->held = $taken === 1;
            return $this->held;
        } catch (\Throwable $e) {
            return false; // locks must never crash the caller
        }
    }

    public function release()
    {
        if (!$this->held) {
            return;
        }
        try {
            Capsule::table(self::TABLE)->where('lock_name', $this->name)->where('owner', $this->owner)->delete();
        } catch (\Throwable $e) {
            // expired locks are taken over by the next run anyway
        }
        $this->held = false;
    }

    public static function purgeStale()
    {
        try {
            return Capsule::table(self::TABLE)->where('locked_until', '<', date('Y-m-d H:i:s', time() - 86400))->delete();
        } catch (\Throwable $e) {
            return 0;
        }
    }
}
