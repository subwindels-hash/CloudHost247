<?php
namespace CloudHost247\Ovh\Services;

use CloudHost247\Ovh\Api\Client;
use CloudHost247\Ovh\Api\Credentials;
use CloudHost247\Ovh\Api\CurlTransport;
use WHMCS\Database\Capsule;
use RuntimeException;

/**
 * Resolves an authenticated OVH client for an endpoint.
 *
 * When the endpoint opts in to the central CloudHost247 API & Integrations
 * vault (integration_key), the application key, application secret and
 * consumer key come from the encrypted vault and are decrypted server-side at
 * call time. Endpoints that have not been migrated keep reading the WHMCS
 * server record.
 */
final class ConnectionResolver
{
    /**
     * Provider keys this module can consume from the central registry. Only
     * `ovh` is listed: the OVH Endpoint allowlist resolves OVHcloud hosts, so
     * a SoYouStart credential must not be routed through it.
     */
    private static $supported = array('ovh');

    public function fromModuleParams(array $p)
    {
        $region = isset($p['configoption1']) ? $p['configoption1'] : 'eu';
        return new Client($region, new Credentials(
            isset($p['serverusername']) ? $p['serverusername'] : '',
            isset($p['serverpassword']) ? $p['serverpassword'] : '',
            isset($p['serveraccesshash']) ? $p['serveraccesshash'] : ''
        ), new CurlTransport());
    }

    public function endpoint($id)
    {
        $ep = Capsule::table('mod_cloudhost247_ovh_endpoints')->where('id', (int) $id)->where('enabled', 1)->first();
        if (!$ep) { throw new RuntimeException('OVH endpoint is disabled or missing.'); }
        $central = $this->central($ep);
        if ($central !== null) { return $central; }
        $s = Capsule::table('tblservers')->where('id', $ep->server_id)->first();
        if (!$s) { throw new RuntimeException('Mapped WHMCS server is missing and no central integration is selected for this endpoint.'); }
        if (!function_exists('decrypt')) { throw new RuntimeException('WHMCS credential decryption is unavailable.'); }
        return new Client($ep->region, new Credentials($s->username, decrypt($s->password), decrypt($s->accesshash)), new CurlTransport());
    }

    /**
     * @param object $ep endpoint row
     * @return Client|null null when the endpoint has not opted in
     */
    private function central($ep)
    {
        $key = isset($ep->integration_key) ? (string) $ep->integration_key : '';
        if ($key === '' || !in_array($key, self::$supported, true)) { return null; }
        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
            $bootstrap = __DIR__ . '/../../../cloudhost247_integrations/bootstrap.php';
            if (!is_file($bootstrap)) { return null; }
            require_once $bootstrap;
        }
        $environment = isset($ep->integration_environment) && $ep->integration_environment ? (string) $ep->integration_environment : null;
        $resolved = \CloudHost247\Integrations\Services\IntegrationManager::optionalCredentials($key, $environment);
        if (!is_array($resolved)) {
            throw new RuntimeException('This OVH endpoint is configured to use the central "' . $key . '" integration, but no usable configuration exists for it. Configure it under Admin, API and Integrations.');
        }
        $secrets = $resolved['secrets'];
        foreach (array('application_key', 'application_secret', 'consumer_key') as $field) {
            if (empty($secrets[$field])) { throw new RuntimeException('The central "' . $key . '" integration is missing its ' . str_replace('_', ' ', $field) . '.'); }
        }
        $region = !empty($resolved['config']['region']) ? (string) $resolved['config']['region'] : (string) $ep->region;
        return new Client($region, new Credentials($secrets['application_key'], $secrets['application_secret'], $secrets['consumer_key']), new CurlTransport());
    }
}
