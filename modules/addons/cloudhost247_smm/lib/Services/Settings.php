<?php
namespace CloudHost247\Smm\Services;

use WHMCS\Database\Capsule;

/** Module settings with safe defaults; stored in the module's own settings table. */
final class Settings
{
    const TABLE = 'mod_cloudhost247_smm_settings';

    public static function defaults()
    {
        return array(
            'status_sync_minutes' => 15,
            'catalog_sync_hours' => 24,
            'reconcile_minutes' => 60,
            'order_batch_size' => 25,
            'reconcile_batch_size' => 10,
            'api_log_retention_days' => 90,
            'automation_enabled' => 1,
            'cron_lock_minutes' => 10,
        );
    }

    public static function all()
    {
        $values = self::defaults();
        try {
            $rows = Capsule::table(self::TABLE)->get();
            foreach ($rows as $row) {
                $key = (string) $row->setting_key;
                if (array_key_exists($key, $values)) {
                    $values[$key] = (string) $row->setting_value;
                }
            }
        } catch (\Throwable $e) {
            // never break a page because settings are unreadable
        }
        return $values;
    }

    public static function get($key, $default = null)
    {
        $all = self::all();
        return array_key_exists($key, $all) ? $all[$key] : $default;
    }

    public static function saveMany(array $pairs, $updatedBy = 0)
    {
        $defaults = self::defaults();
        $now = date('Y-m-d H:i:s');
        foreach ($pairs as $key => $value) {
            if (!array_key_exists($key, $defaults)) {
                continue; // whitelist: settings keys cannot be invented via the UI
            }
            $stored = is_bool($value) ? ($value ? '1' : '0') : (string) $value;
            Capsule::table(self::TABLE)->updateOrInsert(
                array('setting_key' => $key),
                array('setting_value' => $stored, 'updated_at' => $now, 'updated_by' => (int) $updatedBy)
            );
        }
    }

    public static function intBounds($key, $value, $min, $max)
    {
        $value = (int) $value;
        return max($min, min($max, $value));
    }

    /** Internal last-run timestamps written only by the automation orchestrator. */
    public static function runtimeKeys()
    {
        return array('last_status_sync_at', 'last_reconciliation_at', 'last_catalog_sync_at');
    }

    public static function getRuntime($key)
    {
        try {
            $row = Capsule::table(self::TABLE)->where('setting_key', (string) $key)->first();
            return $row === null ? null : (string) $row->setting_value;
        } catch (\Throwable $e) {
            return null;
        }
    }

    public static function saveRuntime($key, $value)
    {
        if (!in_array($key, self::runtimeKeys(), true)) {
            return; // internal keys only
        }
        try {
            Capsule::table(self::TABLE)->updateOrInsert(
                array('setting_key' => $key),
                array('setting_value' => (string) $value, 'updated_at' => date('Y-m-d H:i:s'), 'updated_by' => 0)
            );
        } catch (\Throwable $e) {
            // timestamps are best-effort; never crash automation
        }
    }
}
