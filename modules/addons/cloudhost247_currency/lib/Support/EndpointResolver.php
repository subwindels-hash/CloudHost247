<?php
namespace CloudHost247\Currency\Support;

/**
 * Resolves exchange-rate provider endpoints through the central CloudHost247
 * API & Integrations registry.
 *
 * When an enabled integration exists for the provider in the active
 * environment its administrator-configured base URL is used; otherwise the
 * documented public endpoint is used. No credential is involved: both
 * exchange-rate providers are public read-only APIs.
 */
final class EndpointResolver
{
    public static function baseUrl($providerKey, $fallback)
    {
        $configured = self::central($providerKey);
        return rtrim($configured !== '' ? $configured : (string) $fallback, '/');
    }

    private static function central($providerKey)
    {
        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
            if (!defined('WHMCS')) { return ''; }
            $bootstrap = __DIR__ . '/../../../cloudhost247_integrations/bootstrap.php';
            if (!is_file($bootstrap)) { return ''; }
            require_once $bootstrap;
            if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) { return ''; }
        }
        try {
            $config = \CloudHost247\Integrations\Services\IntegrationManager::configuration($providerKey);
        } catch (\Throwable $error) {
            return '';
        }
        return is_array($config) && !empty($config['base_url']) ? (string) $config['base_url'] : '';
    }
}
