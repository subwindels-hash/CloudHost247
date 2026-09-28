<?php
namespace CloudHost247\ModuleManager\Services;

use CloudHost247\Integrations\Registry\ProviderDefinition;
use CloudHost247\Integrations\Registry\ProviderRegistry;
use CloudHost247\Integrations\Services\IntegrationManager;
use CloudHost247\ModuleManager\Install\Installer;
use CloudHost247\ModuleManager\Registry\ModuleRegistry;
use CloudHost247\ModuleManager\Registry\ModuleRepository;
use CloudHost247\ModuleManager\Registry\ModuleSettings;
use CloudHost247\ModuleManager\Support\ModuleException;
use CloudHost247\ModuleManager\Support\Paths;

/**
 * Platform-facing facade for installed modules.
 *
 * Other code asks this class whether a module may run, what it declares and
 * which API integrations it needs. It is also the bridge to the central API &
 * Integrations centre: a module declares its API requirements as manifest
 * data, and those declarations are registered as real provider definitions so
 * the credentials are configured, encrypted and tested by the existing
 * Super Admin centre rather than by the module itself.
 */
final class ModuleManager
{
    private static $repository = null;
    private static $registered = false;

    public static function repository()
    {
        if (self::$repository === null) { self::$repository = new ModuleRepository(); }
        return self::$repository;
    }

    /** Test seam. */
    public static function useRepository(ModuleRegistry $repository = null)
    {
        self::$repository = $repository;
        self::$registered = false;
    }

    public static function installed()
    {
        return self::repository()->all();
    }

    /** True only when the module is installed, enabled and its files are present. */
    public static function isEnabled($moduleId)
    {
        $row = self::repository()->find($moduleId);
        if (!$row || !$row->enabled || (string) $row->status !== 'installed') { return false; }
        return is_dir(Paths::applicationRoot() . '/' . (string) $row->install_path);
    }

    /**
     * Guard for a module's own runtime code.
     *
     * A module that has been disabled in the Module Manager must stop working,
     * not quietly keep running.
     */
    public static function assertEnabled($moduleId)
    {
        if (!self::isEnabled($moduleId)) {
            throw new ModuleException('The "' . $moduleId . '" module is not enabled in the CloudHost247 Module Manager.', ModuleException::REASON_STATE);
        }
        return true;
    }

    public static function manifest($moduleId)
    {
        return self::repository()->manifest($moduleId);
    }

    /**
     * Platform components that may be named as dependencies.
     * Versions are read from the real addon files, never hard-coded.
     */
    public static function platformComponents()
    {
        $components = array();
        $root = Paths::applicationRoot() . '/modules/addons';
        $known = array(
            'cloudhost247_core' => 'CloudHost247 Foundation',
            'cloudhost247_integrations' => 'CloudHost247 API & Integrations',
            'cloudhost247_modules' => 'CloudHost247 Module Manager',
        );
        foreach ($known as $id => $label) {
            $file = $root . '/' . $id . '/' . $id . '.php';
            if (!is_file($file)) { continue; }
            $components[$id] = array(
                'version' => self::readDeclaredVersion($file),
                'enabled' => true,
                'name' => $label,
                'dependencies' => array(),
            );
        }
        return $components;
    }

    /**
     * Register API provider definitions declared by installed, enabled modules.
     *
     * The definitions are plain manifest data validated by the integrations
     * registry; no PHP from the module is loaded to obtain them.
     *
     * @return array registered provider keys
     */
    public static function registerIntegrations($force = false)
    {
        if (self::$registered && !$force) { return array(); }
        self::$registered = true;
        if (!class_exists('CloudHost247\\Integrations\\Registry\\ProviderRegistry')) { return array(); }

        $registered = array();
        foreach (self::repository()->all() as $row) {
            if (!$row->enabled) { continue; }
            $manifest = self::repository()->manifest((string) $row->module_id);
            if (!$manifest) { continue; }
            foreach ($manifest->integrationDefinitions() as $key => $definition) {
                if (ProviderRegistry::has($key)) { continue; }
                try {
                    $definition['used_by'] = array($manifest->relativeDirectory());
                    ProviderRegistry::register(ProviderDefinition::fromArray($definition));
                    $registered[] = $key;
                } catch (\Throwable $invalid) {
                    // A module may not corrupt the shared registry; skip and keep going.
                    continue;
                }
            }
        }
        return $registered;
    }

    /**
     * Real configuration state of the API integrations a module requires.
     *
     * The state is read from the integrations centre's own overview, which is
     * the same data the health dashboard renders, so a module can never show a
     * connection status the integrations centre does not actually hold.
     *
     * @return array list of array('provider','label','known','configured','enabled',
     *               'status','status_label','last_checked_at','integration_id')
     */
    public static function integrationStatus($moduleId, $environment = null)
    {
        $manifest = self::manifest($moduleId);
        if (!$manifest) { return array(); }

        $overview = self::integrationOverview($environment);
        $rows = array();
        foreach ($manifest->integrationProviders() as $provider) {
            $known = isset($overview[$provider]);
            $row = array(
                'provider' => $provider,
                'label' => $provider,
                'known' => $known,
                'configured' => false,
                'enabled' => false,
                'status' => 'not_configured',
                'status_label' => 'Not configured',
                'last_checked_at' => '',
                'integration_id' => 0,
            );
            if ($known) {
                $entry = $overview[$provider];
                $row['label'] = (string) $entry['display_name'];
                $row['configured'] = (bool) $entry['configured'];
                $row['enabled'] = (bool) $entry['enabled'];
                $row['status'] = (string) $entry['status'];
                $row['status_label'] = (string) $entry['status_label'];
                $row['last_checked_at'] = (string) $entry['last_checked_at'];
                $row['integration_id'] = (int) $entry['integration_id'];
            }
            $rows[] = $row;
        }
        return $rows;
    }

    /**
     * Run the central connection test for an integration a module declares.
     *
     * The test itself belongs to the API & Integrations centre: it holds the
     * encrypted credentials and returns a sanitized classification. The Module
     * Manager only asks for it and reports the classification back.
     *
     * @return array array('ran' => bool, 'code' => string, 'label' => string, 'detail' => string)
     */
    public static function testIntegration($moduleId, $provider, $adminId = null, $environment = null)
    {
        $manifest = self::manifest($moduleId);
        if (!$manifest || !in_array((string) $provider, $manifest->integrationProviders(), true)) {
            throw new ModuleException('That module does not declare this integration.', ModuleException::REASON_STATE);
        }
        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
            return array('ran' => false, 'code' => 'unavailable', 'label' => 'Unavailable',
                'detail' => 'The API & Integrations centre is not installed on this deployment.');
        }
        $overview = self::integrationOverview($environment);
        if (!isset($overview[$provider]) || !$overview[$provider]['configured']) {
            return array('ran' => false, 'code' => 'not_configured', 'label' => 'Not configured',
                'detail' => 'Store credentials for this provider in the API & Integrations centre before testing.');
        }

        $result = IntegrationManager::test((int) $overview[$provider]['integration_id'], $adminId);
        $code = isset($result['code']) ? (string) $result['code'] : 'unknown';
        return array(
            'ran' => true,
            'code' => $code,
            'label' => \CloudHost247\Integrations\Support\ResultCode::label($code),
            // IntegrationManager already returns a sanitized detail: no payload, no credential.
            'detail' => isset($result['detail']) ? (string) $result['detail'] : '',
        );
    }

    /** provider_key => overview row, or an empty set when the centre is absent. */
    private static function integrationOverview($environment = null)
    {
        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) { return array(); }
        try {
            $environment = $environment === null ? \CloudHost247\Integrations\Support\Environment::active() : $environment;
            $overview = array();
            foreach (IntegrationManager::overview($environment) as $row) {
                $overview[(string) $row['provider_key']] = $row;
            }
            return $overview;
        } catch (\Throwable $unavailable) {
            return array();
        }
    }

    /* ------------------------------------------------------------ settings */

    /**
     * Non-secret settings an installed module declared in its manifest,
     * merged over the manifest defaults. Credentials are never stored here.
     *
     * @return array setting key => string value
     */
    public static function settings($moduleId)
    {
        $manifest = self::manifest($moduleId);
        if (!$manifest) { return array(); }
        return ModuleSettings::effective($manifest, self::repository()->settings($moduleId));
    }

    /** One setting value, or $default when the module never declared or saved it. */
    public static function setting($moduleId, $key, $default = null)
    {
        $settings = self::settings($moduleId);
        return array_key_exists($key, $settings) && $settings[$key] !== '' ? $settings[$key] : $default;
    }

    /** Deep link into the API & Integrations centre for a provider. */
    public static function integrationLink($provider)
    {
        return 'addonmodules.php?module=cloudhost247_integrations&view=configure&integration=' . urlencode($provider);
    }

    /**
     * Re-verify one installed module and store the real result.
     *
     * @return array array('status','detail','checked')
     */
    public static function verify($moduleId, Installer $installer = null)
    {
        $installer = $installer ? $installer : new Installer(self::repository());
        $health = $installer->health($moduleId);
        self::repository()->recordHealth($moduleId, $health['status'], $health['detail']);
        return $health;
    }

    /** Read the version a WHMCS addon declares in its _config() function. */
    private static function readDeclaredVersion($file)
    {
        $contents = @file_get_contents($file, false, null, 0, 8192);
        if ($contents === false) { return '0'; }
        if (preg_match("/'version'\s*=>\s*'([0-9][0-9.]*)'/", $contents, $matches)) { return $matches[1]; }
        return '0';
    }
}
