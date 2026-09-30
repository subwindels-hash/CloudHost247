<?php
/**
 * Settings storage for the cart recovery addon. Follows the key/value
 * settings-table convention used by cloudhost247_marketing rather than
 * introducing another configuration mechanism.
 */

namespace CloudHost247\CartRecovery;

use WHMCS\Database\Capsule;

final class SettingsRepository
{
    /** @var array|null in-request cache; cart pages must stay cheap */
    private static $cache = null;

    /**
     * Every value is stored as a string. Durations are seconds so the admin
     * form, cron and tests all share one unit.
     */
    public static function defaults()
    {
        return array(
            'enabled' => '1',
            'enable_reminder_1' => '1',
            'enable_reminder_2' => '1',
            'enable_reminder_3' => '1',
            'abandonment_threshold' => '3600',    // 1 hour of inactivity
            'reminder_1_delay' => '3600',         // 1 hour after abandonment
            'reminder_2_delay' => '86400',        // 24 hours after abandonment
            'reminder_3_delay' => '259200',       // 72 hours after abandonment
            'maximum_reminders' => '3',
            'token_lifetime' => '604800',         // 7 days
            'guest_recovery' => '1',
            'unsubscribe' => '1',
            'batch_size' => '50',
            'retry_delay' => '3600',              // wait before retrying a failed send
            'max_retries' => '3',                 // controlled retry policy per reminder
            'lock_ttl' => '300',                  // cron lock lease in seconds
        );
    }

    public static function boolKeys()
    {
        return array('enabled', 'enable_reminder_1', 'enable_reminder_2', 'enable_reminder_3', 'guest_recovery', 'unsubscribe');
    }

    public static function intKeys()
    {
        return array(
            'abandonment_threshold' => array(60, 2592000),
            'reminder_1_delay' => array(60, 2592000),
            'reminder_2_delay' => array(60, 5184000),
            'reminder_3_delay' => array(60, 7776000),
            'maximum_reminders' => array(0, 3),
            'token_lifetime' => array(3600, 7776000),
            'batch_size' => array(1, 500),
            'retry_delay' => array(300, 604800),
            'max_retries' => array(1, 10),
            'lock_ttl' => array(60, 3600),
        );
    }

    public static function all()
    {
        if (self::$cache !== null) {
            return self::$cache;
        }
        $values = self::defaults();
        try {
            foreach (Capsule::table(Schema::SETTINGS)->get() as $row) {
                $key = is_object($row) ? $row->setting : $row['setting'];
                if (array_key_exists($key, $values)) {
                    $values[$key] = (string) (is_object($row) ? $row->value : $row['value']);
                }
            }
        } catch (\Throwable $e) {
            Log::error('settings.read_failed', array('error' => Log::safeError($e)));
        }
        self::$cache = $values;
        return $values;
    }

    public static function get($key)
    {
        $values = self::all();
        return isset($values[$key]) ? $values[$key] : '';
    }

    public static function int($key)
    {
        return (int) self::get($key);
    }

    public static function enabled($key)
    {
        return self::get($key) === '1';
    }

    /** Delay (seconds after abandonment) for a given reminder number. */
    public static function reminderDelay($number)
    {
        $number = (int) $number;
        if ($number < 1 || $number > 3) {
            return 0;
        }
        return self::int('reminder_' . $number . '_delay');
    }

    public static function reminderEnabled($number)
    {
        $number = (int) $number;
        if ($number < 1 || $number > 3) {
            return false;
        }
        return self::enabled('enable_reminder_' . $number);
    }

    /** Writes defaults for keys that do not exist yet; never overwrites. */
    public static function seed()
    {
        $now = date('Y-m-d H:i:s');
        foreach (self::defaults() as $key => $value) {
            $exists = Capsule::table(Schema::SETTINGS)->where('setting', $key)->first();
            if (!$exists) {
                Capsule::table(Schema::SETTINGS)->insert(array('setting' => $key, 'value' => $value, 'updated_at' => $now));
            }
        }
        self::$cache = null;
    }

    /**
     * Validates and persists admin-submitted settings. Unknown keys are
     * ignored and numeric values are clamped to sane bounds.
     */
    public static function save(array $input)
    {
        $now = date('Y-m-d H:i:s');
        $bounds = self::intKeys();
        $stored = array();
        foreach (self::defaults() as $key => $default) {
            if (!array_key_exists($key, $input)) {
                continue;
            }
            $raw = $input[$key];
            if (in_array($key, self::boolKeys(), true)) {
                $value = ($raw === '1' || $raw === 1 || $raw === true) ? '1' : '0';
            } elseif (isset($bounds[$key])) {
                $value = (string) max($bounds[$key][0], min($bounds[$key][1], (int) $raw));
            } else {
                $value = (string) $raw;
            }
            Capsule::table(Schema::SETTINGS)->updateOrInsert(
                array('setting' => $key),
                array('value' => $value, 'updated_at' => $now)
            );
            $stored[$key] = $value;
        }
        self::$cache = null;
        return $stored;
    }

    /** Test/CLI helper: drop the per-request cache. */
    public static function flush()
    {
        self::$cache = null;
    }
}
