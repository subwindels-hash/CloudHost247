<?php
namespace CloudHost247\Rdp\Api;

/**
 * Resolves the RDP provider endpoint and access token.
 *
 * The central CloudHost247 API & Integrations vault is authoritative: when an
 * enabled `rdp` integration exists for the active environment its encrypted
 * credentials are used. The WHMCS server record is only a documented fallback
 * for installations that have not migrated yet, and the host allowlist in
 * ProviderClient still applies to both paths.
 */
final class ConfigResolver
{
    const PROVIDER = 'rdp';

    /**
     * @param array $params WHMCS server module parameters
     * @return array endpoint, token, source
     */
    public static function resolve(array $params)
    {
        $central = self::central();
        if ($central !== null) { return $central; }
        $host = trim((string) (isset($params['serverhostname']) ? $params['serverhostname'] : ''));
        $port = (int) (isset($params['serverport']) ? $params['serverport'] : 0);
        return array(
            'endpoint' => 'https://' . $host . ($port ? ':' . $port : ''),
            'token' => (string) (isset($params['serveraccesshash']) ? $params['serveraccesshash'] : ''),
            'source' => 'whmcs_server',
        );
    }

    /** @return array|null */
    private static function central()
    {
        if (!self::vaultAvailable()) { return null; }
        $resolved = \CloudHost247\Integrations\Services\IntegrationManager::optionalCredentials(self::PROVIDER);
        if (!is_array($resolved)) { return null; }
        $endpoint = isset($resolved['config']['base_url']) ? (string) $resolved['config']['base_url'] : '';
        $token = isset($resolved['secrets']['access_token']) ? (string) $resolved['secrets']['access_token'] : '';
        if ($endpoint === '' || $token === '') { return null; }
        return array('endpoint' => $endpoint, 'token' => $token, 'source' => 'integrations_vault');
    }

    private static function vaultAvailable()
    {
        if (class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) { return true; }
        if (!defined('WHMCS')) { return false; }
        $bootstrap = __DIR__ . '/../../../../addons/cloudhost247_integrations/bootstrap.php';
        if (!is_file($bootstrap)) { return false; }
        require_once $bootstrap;
        return class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager');
    }
}
