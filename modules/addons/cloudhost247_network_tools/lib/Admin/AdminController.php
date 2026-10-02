<?php
namespace CloudHost247\NetworkTools\Admin;

use CloudHost247\NetworkTools\Core\Repository\AbuseRepository;
use CloudHost247\NetworkTools\Core\Repository\CacheRepository;
use CloudHost247\NetworkTools\Core\Repository\ExecutionLogRepository;
use CloudHost247\NetworkTools\Core\Repository\HealthRepository;
use CloudHost247\NetworkTools\Core\Repository\ProviderRepository;
use CloudHost247\NetworkTools\Core\Repository\ResolverRepository;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;
use CloudHost247\NetworkTools\Core\Repository\ToolStateRepository;
use CloudHost247\NetworkTools\Core\Registry\ToolCategories;
use CloudHost247\NetworkTools\Core\Registry\ToolRegistry;
use CloudHost247\NetworkTools\Core\Runner\ToolRunner;
use CloudHost247\NetworkTools\Services\Shared\HealthChecker;

/**
 * Super Admin control centre (docs section 78).
 *
 * Every action is POST + WHMCS admin CSRF token + AdminGuard, and every change
 * is written to the existing CloudHost247 audit log through the repositories
 * (which redact secret-looking keys). Read-only views (overview, tools,
 * resolvers, providers, health, analytics, abuse) render the real rows.
 */
final class AdminController
{
    const CAPABILITY = 'tools.manage';

    /** @var SettingsRepository */
    private $settings;
    /** @var ToolStateRepository */
    private $states;
    /** @var ResolverRepository */
    private $resolvers;
    /** @var ProviderRepository */
    private $providers;

    public function __construct()
    {
        $this->settings = new SettingsRepository();
        $this->states = new ToolStateRepository();
        $this->resolvers = new ResolverRepository();
        $this->providers = new ProviderRepository();
    }

    public function handle()
    {
        $data = array(
            'view' => isset($_GET['ch247view']) ? preg_replace('/[^a-z]/', '', strtolower((string) $_GET['ch247view'])) : 'overview',
            'notice' => '',
            'error' => '',
            'csrf' => function_exists('generate_token') ? generate_token('plain') : '',
        );
        if (!$this->supportedView($data['view'])) {
            $data['view'] = 'overview';
        }
        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') === 'POST' && isset($_POST['ch247_action'])) {
            try {
                $data['notice'] = $this->dispatch(preg_replace('/[^a-z_]/', '', strtolower((string) $_POST['ch247_action'])));
            } catch (\Throwable $failure) {
                $data['error'] = $failure->getMessage();
            }
        }
        $data['views'] = $this->views();
        $data['settings'] = $this->settings->all();
        $data['setting_keys'] = $this->settings->defaults();
        $data['tools'] = $this->toolsView();
        $data['categories'] = ToolCategories::all();
        $data['resolvers'] = $this->resolvers->all(false);
        $data['providers'] = $this->providers->all(false);
        $data['health'] = array(
            'resolver' => (new HealthRepository())->summary('resolver'),
            'provider' => (new HealthRepository())->summary('provider'),
        );
        $data['metrics'] = (new ExecutionLogRepository())->metrics(30);
        $data['recent_executions'] = (new ExecutionLogRepository())->recent(50);
        $data['abuse'] = (new AbuseRepository())->recent(50);
        $data['cache_size'] = (new CacheRepository())->size();
        $data['tool_count'] = ToolRegistry::count();
        $data['rate_limits'] = array(
            'local' => \CloudHost247\NetworkTools\Core\Security\RateLimiter::defaultLimits('local'),
            'standard' => \CloudHost247\NetworkTools\Core\Security\RateLimiter::defaultLimits('standard'),
            'high_risk' => \CloudHost247\NetworkTools\Core\Security\RateLimiter::defaultLimits('high_risk'),
        );
        return $data;
    }

    private function supportedView($view)
    {
        return in_array($view, array('overview', 'tools', 'resolvers', 'providers', 'health', 'analytics', 'abuse', 'settings'), true);
    }

    private function views()
    {
        return array(
            'overview' => 'Overview',
            'tools' => 'Tools',
            'resolvers' => 'Resolvers',
            'providers' => 'Providers',
            'health' => 'Health',
            'analytics' => 'Analytics',
            'abuse' => 'Abuse controls',
            'settings' => 'Settings',
        );
    }

    private function toolsView()
    {
        $rows = array();
        foreach (ToolRegistry::all() as $definition) {
            $state = $this->states->find($definition->slug());
            $runnerStatus = (new ToolRunner())->status($definition);
            $rows[] = array(
                'slug' => $definition->slug(),
                'name' => $definition->name(),
                'category' => $definition->category(),
                'visibility' => $state ? (string) $state->visibility : $definition->visibility(),
                'status' => $state ? (string) $state->status : 'ACTIVE',
                'enabled' => $state ? (int) $state->enabled : 1,
                'rate_tier' => $state ? (string) $state->rate_tier : $definition->rateTier(),
                'timeout_seconds' => $state ? (int) $state->timeout_seconds : $definition->timeoutSeconds(),
                'cache_seconds' => $state ? (int) $state->cache_seconds : $definition->cacheSeconds(),
                'providers' => implode(',', $definition->providers()),
                'effective_state' => $runnerStatus['state'],
                'effective_detail' => $runnerStatus['detail'],
                'rate_limits' => $state ? (string) $state->rate_limits_json : '',
            );
        }
        return $rows;
    }

    private function dispatch($action)
    {
        if (class_exists('CloudHost247\\Foundation\\Security\\AdminGuard')) {
            \CloudHost247\Foundation\Security\AdminGuard::requirePostToken();
            \CloudHost247\Foundation\Security\AdminGuard::requireCapability('cloudhost247_network_tools', self::CAPABILITY);
        }
        switch ($action) {
            case 'tool_save':
                return $this->toolSave();
            case 'resolver_save':
                return $this->resolverSave();
            case 'resolver_toggle':
                return $this->resolverToggle();
            case 'resolver_delete':
                return $this->resolverDelete();
            case 'resolver_seed':
                $created = $this->resolvers->seed();
                return $created . ' resolver row(s) added. Existing rows were left untouched.';
            case 'provider_save':
                return $this->providerSave();
            case 'provider_toggle':
                return $this->providerToggle();
            case 'provider_delete':
                return $this->providerDelete();
            case 'settings_save':
                return $this->settingsSave();
            case 'cache_flush':
                (new CacheRepository())->flush();
                $this->audit('cache.flushed', 'cache', array(), array('size' => 0));
                return 'The tool result cache has been emptied.';
            case 'health_run':
                return $this->healthRun();
            case 'history_prune':
                $deleted = (new ExecutionLogRepository())->prune((int) $this->settings->int('history_retention_days', 90));
                $this->audit('history.pruned', 'executions', array(), array('deleted' => $deleted));
                return $deleted . ' execution record(s) older than the retention window were deleted.';
            default:
                throw new \RuntimeException('Unknown action.');
        }
    }

    private function toolSave()
    {
        $slug = isset($_POST['slug']) ? (string) $_POST['slug'] : '';
        $definition = ToolRegistry::get($slug);
        if ($definition === null) {
            throw new \RuntimeException('That tool does not exist.');
        }
        $status = isset($_POST['status']) ? strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $_POST['status'])) : 'ACTIVE';
        if (!in_array($status, array('ACTIVE', 'DISABLED', 'MAINTENANCE', 'CONFIGURATION_REQUIRED', 'SERVICE_UNAVAILABLE'), true)) {
            throw new \RuntimeException('That status is not one of the five documented tool states.');
        }
        $visibility = isset($_POST['visibility']) ? (string) $_POST['visibility'] : $definition->visibility();
        if (!in_array($visibility, array('public', 'customer', 'admin'), true)) {
            throw new \RuntimeException('Visibility must be public, customer or admin.');
        }
        $rateTier = isset($_POST['rate_tier']) ? (string) $_POST['rate_tier'] : $definition->rateTier();
        if (!in_array($rateTier, array('local', 'standard', 'high_risk'), true)) {
            throw new \RuntimeException('Rate tier must be local, standard or high_risk.');
        }
        $changes = array(
            'status' => $status,
            'visibility' => $visibility,
            'rate_tier' => $rateTier,
            'timeout_seconds' => $this->boundedInt('timeout_seconds', 1, 60, $definition->timeoutSeconds()),
            'cache_seconds' => $this->boundedInt('cache_seconds', 0, 86400, $definition->cacheSeconds()),
            'provider_keys' => $this->providerKeys(isset($_POST['provider_keys']) ? (string) $_POST['provider_keys'] : implode(',', $definition->providers())),
        );
        $limits = array();
        foreach (array('ip', 'client', 'tool_ip', 'tool_global') as $dimension) {
            $count = isset($_POST['limit_' . $dimension . '_count']) ? (int) $_POST['limit_' . $dimension . '_count'] : 0;
            $window = isset($_POST['limit_' . $dimension . '_window']) ? (int) $_POST['limit_' . $dimension . '_window'] : 0;
            if ($count > 0 && $window > 0) {
                $limits[$dimension] = array(min(100000, $count), min(86400, $window));
            }
        }
        $changes['rate_limits_json'] = $limits ? $this->json($limits) : null;
        $this->states->update($slug, $changes);
        return 'Saved settings for ' . $definition->name() . '.';
    }

    private function resolverSave()
    {
        $id = isset($_POST['resolver_id']) ? (int) $_POST['resolver_id'] : 0;
        $data = array(
            'name' => $this->post('name'),
            'provider' => $this->post('provider'),
            'ip_address' => $this->post('ip_address'),
            'protocol' => in_array($this->post('protocol'), array('udp', 'tcp', 'dot', 'doh'), true) ? $this->post('protocol') : 'udp',
            'version' => $this->post('version') === 'v6' ? 'v6' : 'v4',
            'country_code' => $this->post('country_code'),
            'region' => $this->post('region'),
            'city' => $this->post('city'),
            'latitude' => $this->post('latitude') === '' ? null : (float) $this->post('latitude'),
            'longitude' => $this->post('longitude') === '' ? null : (float) $this->post('longitude'),
            'endpoint' => $this->post('endpoint'),
            'enabled' => isset($_POST['enabled']) ? 1 : 0,
            'priority' => $this->boundedInt('priority', 1, 9999, 100),
        );
        if ($data['name'] === '' || $data['ip_address'] === '') {
            throw new \RuntimeException('A resolver needs a name and an IP address.');
        }
        if (!filter_var($data['ip_address'], FILTER_VALIDATE_IP)) {
            throw new \RuntimeException('The resolver address is not a valid IPv4 or IPv6 address.');
        }
        if (in_array($data['protocol'], array('dot', 'doh'), true) && $data['endpoint'] === '') {
            throw new \RuntimeException('A DoT or DoH resolver needs an endpoint (hostname for DoT, HTTPS URL for DoH).');
        }
        if ($data['protocol'] === 'doh' && stripos($data['endpoint'], 'https://') !== 0) {
            throw new \RuntimeException('A DoH endpoint must be an https:// URL.');
        }
        if ($id > 0) {
            $this->resolvers->update($id, $data);
            return 'Resolver updated.';
        }
        $this->resolvers->insert($data);
        return 'Resolver added.';
    }

    private function resolverToggle()
    {
        $id = (int) (isset($_POST['resolver_id']) ? $_POST['resolver_id'] : 0);
        $row = $this->resolvers->find($id);
        if (!$row) {
            throw new \RuntimeException('That resolver does not exist.');
        }
        $this->resolvers->update($id, array('enabled' => (int) $row->enabled === 1 ? 0 : 1));
        return 'Resolver ' . ((int) $row->enabled === 1 ? 'disabled' : 'enabled') . '.';
    }

    private function resolverDelete()
    {
        $id = (int) (isset($_POST['resolver_id']) ? $_POST['resolver_id'] : 0);
        if (!$this->resolvers->delete($id)) {
            throw new \RuntimeException('That resolver could not be removed.');
        }
        return 'Resolver removed. Historical checks that referenced it were kept without it.';
    }

    private function providerSave()
    {
        $id = isset($_POST['provider_id']) ? (int) $_POST['provider_id'] : 0;
        $type = in_array($this->post('type'), ProviderRepository::types(), true) ? $this->post('type') : 'http';
        $configuration = array();
        if ($this->post('configuration') !== '') {
            $decoded = json_decode($this->post('configuration'), true);
            if (!is_array($decoded)) {
                throw new \RuntimeException('The configuration must be a JSON object. It is stored as non-secret metadata only.');
            }
            $configuration = $decoded;
        }
        $data = array(
            'provider_key' => preg_replace('/[^a-zA-Z0-9_.\-]/', '', $this->post('provider_key')),
            'label' => $this->post('label'),
            'type' => $type,
            'endpoint' => $this->post('endpoint'),
            'configuration' => $configuration,
            'enabled' => isset($_POST['enabled']) ? 1 : 0,
            'priority' => $this->boundedInt('priority', 1, 9999, 100),
            'timeout_seconds' => $this->boundedInt('timeout_seconds', 1, 30, 5),
            'rate_limit_per_minute' => $this->boundedInt('rate_limit_per_minute', 0, 10000, 30),
        );
        if ($data['provider_key'] === '' || $data['label'] === '') {
            throw new \RuntimeException('A provider needs a key and a label.');
        }
        if (isset($configuration['api_key']) || isset($configuration['token']) || isset($configuration['password'])) {
            throw new \RuntimeException('This table stores non-secret metadata only. Put credentials in Admin → API & Integrations, which keeps them encrypted, and reference the provider key here.');
        }
        if ($id > 0) {
            $this->providers->update($id, $data);
            return 'Provider updated.';
        }
        $this->providers->insert($data);
        return 'Provider added.';
    }

    private function providerToggle()
    {
        $id = (int) (isset($_POST['provider_id']) ? $_POST['provider_id'] : 0);
        $row = $this->providers->find($id);
        if (!$row) {
            throw new \RuntimeException('That provider does not exist.');
        }
        $this->providers->update($id, array('enabled' => (int) $row->enabled === 1 ? 0 : 1));
        return 'Provider ' . ((int) $row->enabled === 1 ? 'disabled' : 'enabled') . '.';
    }

    private function providerDelete()
    {
        $id = (int) (isset($_POST['provider_id']) ? $_POST['provider_id'] : 0);
        if (!$this->providers->delete($id)) {
            throw new \RuntimeException('That provider could not be removed.');
        }
        return 'Provider removed.';
    }

    private function settingsSave()
    {
        $allowed = $this->settings->defaults();
        $saved = 0;
        foreach ($allowed as $key => $default) {
            if (!array_key_exists('setting_' . $key, $_POST)) {
                continue;
            }
            $value = (string) $_POST['setting_' . $key];
            if (preg_match('/^(enabled|public_access|trust_proxy_headers|history_enabled|monitoring_enabled|ai_explanations_enabled)$/', $key)) {
                $value = $value === '1' ? '1' : '0';
            } elseif (preg_match('/_seconds$|_days$|_minutes$|_megabytes$|threshold$|_limit$|_retries$/', $key)) {
                $value = (string) max(0, (int) $value);
            }
            $this->settings->set($key, $value);
            $saved++;
        }
        return $saved . ' setting(s) saved.';
    }

    private function healthRun()
    {
        if (!class_exists('CloudHost247\\NetworkTools\\Services\\Shared\\HealthChecker')) {
            throw new \RuntimeException('The health checker is unavailable in this build.');
        }
        $summary = (new HealthChecker($this->resolvers, $this->providers, $this->settings))->run();
        return 'Health check finished: ' . (int) $summary['checked'] . ' subject(s) checked, ' . (int) $summary['failed'] . ' failure(s).';
    }

    private function audit($action, $resourceId, array $before, array $after)
    {
        if (class_exists('CloudHost247\\Foundation\\Support\\AuditLogger')) {
            \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_network_tools', $action, 'tool_config', $resourceId, $before, $after);
        }
    }

    private function post($key)
    {
        return isset($_POST[$key]) && is_scalar($_POST[$key]) ? trim((string) $_POST[$key]) : '';
    }

    private function boundedInt($key, $min, $max, $default)
    {
        if (!isset($_POST[$key]) || !is_numeric($_POST[$key])) {
            return $default;
        }
        return max($min, min($max, (int) $_POST[$key]));
    }

    private function providerKeys($value)
    {
        $keys = array();
        foreach (preg_split('/[\s,]+/', (string) $value, -1, PREG_SPLIT_NO_EMPTY) as $key) {
            $key = preg_replace('/[^a-zA-Z0-9_.\-]/', '', $key);
            if ($key !== '') {
                $keys[] = $key;
            }
        }
        return implode(',', array_slice(array_unique($keys), 0, 20));
    }

    private function json($value)
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
