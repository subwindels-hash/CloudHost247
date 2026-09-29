<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/**
 * Key/value platform settings for Super Admin -> Domain Brokerage -> Settings
 * (requirement #35). Defaults are safe (brokerage disabled, manual fallback
 * enabled) so an unconfigured deployment never silently exposes the feature.
 */
final class SettingsRepository
{
    const TABLE = 'mod_cloudhost247_broker_settings';

    private static $defaults = array(
        'brokerage_enabled' => '0',
        'manual_broker_fallback' => '1',
        'supported_currencies' => 'USD,EUR,GBP',
        'contact_attempt_limit' => '3',
        'negotiation_expiration_hours' => '72',
        'customer_notifications_enabled' => '1',
        'transfer_verification_required' => '1',
        'refund_window_days' => '14',
        'brokerage_terms_url' => '/domain-brokerage-terms.php',
        'request_rate_limit_per_hour' => '5',
    );

    public function all()
    {
        $rows = Capsule::table(self::TABLE)->get();
        $values = self::$defaults;
        foreach ($rows as $row) { $values[$row->setting_key] = $row->setting_value; }
        return $values;
    }

    public function get($key, $fallback = null)
    {
        $row = Capsule::table(self::TABLE)->where('setting_key', (string) $key)->first();
        if ($row) { return $row->setting_value; }
        return array_key_exists($key, self::$defaults) ? self::$defaults[$key] : $fallback;
    }

    public function set($key, $value)
    {
        Capsule::table(self::TABLE)->updateOrInsert(
            array('setting_key' => (string) $key),
            array('setting_value' => (string) $value, 'updated_at' => date('Y-m-d H:i:s'))
        );
    }

    public function setMany(array $values)
    {
        foreach ($values as $key => $value) { $this->set($key, $value); }
    }

    public function isBrokerageEnabled()
    {
        return $this->get('brokerage_enabled', '0') === '1';
    }
}
