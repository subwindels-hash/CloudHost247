<?php
namespace CloudHost247\Marketing\Repositories;

use WHMCS\Database\Capsule;

/**
 * Module-scoped operational settings (requirement #50). Credentials are
 * NEVER stored here — sender credentials live in the central CloudHost247
 * Integrations vault (provider key cpanel_smtp).
 */
final class SettingsRepository
{
    const TABLE = 'mod_cloudhost247_marketing_settings';

    public function defaults()
    {
        return array(
            'enabled' => '1',
            'default_provider' => 'cpanel_smtp',
            'default_from_name' => '',
            'default_from_email' => '',
            'default_reply_to' => '',
            'default_timezone' => 'UTC',
            'batch_size' => '25',
            'messages_per_minute' => '60',
            'hourly_limit' => '500',
            'concurrent_workers' => '1',
            'retry_attempts' => '3',
            'retry_backoff_minutes' => '5,30,120',
            'bounce_soft_threshold' => '3',
            'open_tracking_enabled' => '1',
            'click_tracking_enabled' => '1',
            'company_name' => '',
            'physical_address' => '',
            'support_url' => '',
            'account_url' => '',
            'footer_html' => '',
            'compliance_note' => '',
            'queue_lock_seconds' => '120',
            'events_retention_days' => '180',
        );
    }

    public function get($key)
    {
        $row = Capsule::table(self::TABLE)->where('setting_key', (string) $key)->first();
        if ($row) { return (string) $row->setting_value; }
        $defaults = $this->defaults();
        return isset($defaults[$key]) ? $defaults[$key] : '';
    }

    public function set($key, $value)
    {
        if (!array_key_exists($key, $this->defaults())) {
            throw new \InvalidArgumentException('Unknown marketing setting: ' . $key);
        }
        Capsule::table(self::TABLE)->updateOrInsert(
            array('setting_key' => (string) $key),
            array('setting_value' => (string) $value, 'updated_at' => date('Y-m-d H:i:s'))
        );
    }

    public function all()
    {
        $values = $this->defaults();
        foreach (Capsule::table(self::TABLE)->get() as $row) {
            if (array_key_exists($row->setting_key, $values)) {
                $values[$row->setting_key] = (string) $row->setting_value;
            }
        }
        return $values;
    }

    /** Idempotent activation seeding: writes defaults only for keys that have no row yet. */
    public function seedDefaults()
    {
        foreach ($this->defaults() as $key => $value) {
            $exists = Capsule::table(self::TABLE)->where('setting_key', $key)->first();
            if (!$exists) {
                Capsule::table(self::TABLE)->insert(array(
                    'setting_key' => $key,
                    'setting_value' => $value,
                    'updated_at' => date('Y-m-d H:i:s'),
                ));
            }
        }
    }

    public function intValue($key, $min = 0, $max = PHP_INT_MAX)
    {
        $value = (int) $this->get($key);
        return max($min, min($max, $value));
    }
}
