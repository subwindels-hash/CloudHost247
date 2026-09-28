<?php

declare(strict_types=1);

namespace CloudHost247\LTEProxy;

/**
 * Single configuration resolver for the LTE Proxy module.
 *
 * The central CloudHost247 API & Integrations vault is authoritative for the
 * API endpoint and the API key. The legacy per-product configuration options
 * are a deprecated fallback for installations that have not migrated yet.
 *
 * No endpoint, key or secret is hard-coded here: an unconfigured module fails
 * in a controlled way instead of silently calling a default host.
 *
 * @package CloudHost247\LTEProxy
 */
final class Configuration
{
    public const PROVIDER = 'lteproxy';

    /**
     * Credentials from the central vault, or empty strings when the centre is
     * not installed or this provider is not configured for the active
     * environment.
     *
     * @return array{api_key:string,base_url:string,source:string}
     */
    public static function central(): array
    {
        $empty = ['api_key' => '', 'base_url' => '', 'source' => 'module_config_legacy'];
        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
            $bootstrap = __DIR__ . '/../../../addons/cloudhost247_integrations/bootstrap.php';
            if (!defined('WHMCS') || !is_file($bootstrap)) {
                return $empty;
            }
            require_once $bootstrap;
            if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
                return $empty;
            }
        }
        $resolved = \CloudHost247\Integrations\Services\IntegrationManager::optionalCredentials(self::PROVIDER);
        if (!is_array($resolved)) {
            return $empty;
        }
        return [
            'api_key' => (string) ($resolved['secrets']['api_key'] ?? ''),
            'base_url' => (string) ($resolved['config']['base_url'] ?? ''),
            'source' => 'integrations_vault',
        ];
    }

    /**
     * Full module configuration for a set of WHMCS module parameters.
     *
     * @param array $params WHMCS module parameters
     * @param string $storageRoot directory that holds the logs and cache folders
     */
    public static function resolve(array $params, string $storageRoot): array
    {
        $central = self::central();

        return [
            'api_key' => $central['api_key'] !== '' ? $central['api_key'] : (string) ($params['configoption1'] ?? ''),
            'api_secret' => '',
            'api_base_url' => $central['base_url'] !== '' ? $central['base_url'] : (string) ($params['configoption3'] ?? ''),
            'credential_source' => $central['source'],
            'api_timeout' => (int) ($params['configoption4'] ?? 30),
            'proxy_type' => $params['configoption5'] ?? 'SOCKS5',
            'connection_type' => $params['configoption6'] ?? 'WIFI_AND_CELLULAR',
            'rotation_type' => $params['configoption7'] ?? 'manual',
            'rotation_interval' => (int) ($params['configoption8'] ?? 60),
            'region' => $params['configoption9'] ?? 'us',
            'carrier' => $params['configoption10'] ?? 'verizon',
            'auth_type' => $params['configoption11'] ?? 'username_password',
            'trial_enabled' => (bool) ($params['configoption12'] ?? false),
            'trial_duration' => (int) ($params['configoption13'] ?? 24),
            'auto_provision' => (bool) ($params['configoption14'] ?? true),
            'logging_enabled' => (bool) ($params['configoption15'] ?? true),
            'log_level' => $params['configoption16'] ?? 'INFO',
            'cache_enabled' => (bool) ($params['configoption17'] ?? true),
            'rate_limit_requests' => (int) ($params['configoption18'] ?? 60),
            'log_directory' => rtrim($storageRoot, '/') . '/logs',
            'cache_directory' => rtrim($storageRoot, '/') . '/cache',
        ];
    }
}
