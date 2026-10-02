<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Module settings (mod_cloudhost247_nt_settings): a documented key/value store
 * owned by the addon dashboard, plus the module's own WHMCS addon fields for
 * values WHMCS must render. Defaults live in code so a fresh install behaves
 * predictably without a seed job.
 */
final class SettingsRepository extends Repository
{
    const TABLE = 'settings';

    private static $defaults = array(
        'enabled' => '1',
        'public_access' => '1',
        'trust_proxy_headers' => '0',
        'history_enabled' => '1',
        'history_retention_days' => '90',
        'monitoring_enabled' => '1',
        'ai_explanations_enabled' => '1',
        'analytics_retention_days' => '180',
        'default_timeout_seconds' => '10',
        'dns_timeout_seconds' => '5',
        'dns_retries' => '2',
        'propagation_resolver_limit' => '40',
        'propagation_timeout_seconds' => '20',
        'crawl_max_pages' => '10',
        'crawl_max_links' => '250',
        'crawl_max_runtime_seconds' => '25',
        'crawl_max_response_bytes' => '524288',
        'http_max_response_bytes' => '262144',
        'speedtest_max_megabytes' => '8',
        'speedtest_max_seconds' => '20',
        'abuse_block_threshold' => '5',
        'resolver_health_interval_minutes' => '15',
        'provider_health_interval_minutes' => '30',
        'geoip_provider' => '',
        'ssl_monitor_intervals' => '30,14,7,3,1',
        'default_history_scope' => 'metadata',
    );

    /** @var array|null */
    private $cache;

    public function defaults()
    {
        return self::$defaults;
    }

    public function all()
    {
        if ($this->cache !== null) {
            return $this->cache;
        }
        $values = self::$defaults;
        if ($this->has(self::TABLE)) {
            try {
                foreach ($this->table(self::TABLE)->get() as $row) {
                    $values[$row->setting_key] = $row->setting_value;
                }
            } catch (\Throwable $unavailable) {
                // Fall through to defaults; the caller records the incident.
            }
        }
        $this->cache = $values;
        return $values;
    }

    public function get($key, $default = null)
    {
        $all = $this->all();
        if (array_key_exists($key, $all)) {
            return $all[$key];
        }
        return $default === null ? (isset(self::$defaults[$key]) ? self::$defaults[$key] : null) : $default;
    }

    public function bool($key)
    {
        return in_array(strtolower((string) $this->get($key, '0')), array('1', 'true', 'yes', 'on'), true);
    }

    public function int($key)
    {
        return (int) $this->get($key, '0');
    }

    public function set($key, $value, $adminId = null)
    {
        if (!preg_match('/^[a-z0-9_]{2,64}$/', (string) $key)) {
            throw new \InvalidArgumentException('Invalid setting key.');
        }
        $this->cache = null;
        $before = $this->get($key, null);
        $this->table(self::TABLE)->updateOrInsert(
            array('setting_key' => $key),
            array('setting_value' => (string) $value, 'updated_at' => $this->now())
        );
        $this->audit('setting.updated', $key, array('value' => $before), array('value' => $value), $adminId);
        return true;
    }

    protected function audit($action, $resourceId, array $before, array $after, $adminId = null)
    {
        if (class_exists('CloudHost247\\Foundation\\Support\\AuditLogger')) {
            \CloudHost247\Foundation\Support\AuditLogger::record(
                'cloudhost247_network_tools', $action, 'setting', (string) $resourceId,
                $this->redact($before), $this->redact($after), 'success', null, $adminId
            );
        }
    }
}
