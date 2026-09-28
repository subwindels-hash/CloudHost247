<?php
namespace CloudHost247\ModuleManager\Services;

use CloudHost247\Integrations\Registry\ProviderDefinition;
use CloudHost247\Integrations\Registry\ProviderRegistry;
use CloudHost247\Integrations\Services\IntegrationManager;
use CloudHost247\ModuleManager\Install\Installer;
use CloudHost247\ModuleManager\Registry\ModuleRegistry;
use CloudHost247\ModuleManager\Registry\ModuleRepository;
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
     * @return array list of array('provider','label','configured','status','status_label','known')
     */
    public static function integrationStatus($moduleId, $environment = null)
    {
        $manifest = self::manifest($moduleId);
        if (!$manifest) { return array(); }
        $rows = array();
        $haveIntegrations = class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager');
        foreach ($manifest->integrationProviders() as $provider) {
            $known = $haveIntegrations && ProviderRegistry::has($provider);
            $row = array(
                'provider' => $provider,
                'label' => $known ? ProviderRegistry::get($provider)->label() : $provider,
                'known' => $known,
                'configured' => false,
                'status' => 'not_configured',
                'status_label' => 'Not configured',
            );
            if ($known) {
                $configuration = IntegrationManager::configuration($provider, $environment);
                if ($configuration) {
                    $row['configured'] = true;
                    $row['status'] = (string) $configuration['status'];
                    $row['status_label'] = \CloudHost247\Integrations\Support\ResultCode::label($configuration['status']);
                }
            }
            $rows[] = $row;
        }
        return $rows;
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
