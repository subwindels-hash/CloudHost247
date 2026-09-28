<?php
/**
 * CloudHost247 Module Manager.
 *
 * Super Admin -> Modules. Upload, validate, install, update, enable, disable
 * and uninstall modules from the admin dashboard, without extracting archives
 * over SSH or cPanel.
 *
 * Installing a module places executable server-side code on this host, so the
 * whole pipeline is treated as a privileged security operation: archives are
 * inspected before extraction, extraction is confined to one directory, every
 * installation is backed up and rolled back on failure, and every action is
 * audited.
 */
if (!defined('WHMCS')) { die('Direct access denied'); }

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';
require_once __DIR__ . '/migrations/V110.php';

use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\ModuleManager\Migrations\ModuleManagerInitialMigration;
use CloudHost247\ModuleManager\Migrations\ModuleSettingsMigration;
use CloudHost247\ModuleManager\Package\PackageStorage;
use CloudHost247\ModuleManager\Security\CapabilityPolicy;
use CloudHost247\ModuleManager\Services\AdminController;
use CloudHost247\ModuleManager\Services\AdminView;
use CloudHost247\ModuleManager\Services\ModuleManager;

function cloudhost247_modules_config()
{
    return array(
        'name' => 'CloudHost247 Module Manager',
        'description' => 'Super Admin centre to upload, validate, install, update, enable, disable and uninstall modules with secure archive handling, transactional installation, rollback and full audit logging.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        'fields' => array(),
    );
}

function cloudhost247_modules_activate()
{
    try {
        $applied = (new MigrationRunner())->run('cloudhost247_modules', array(new ModuleManagerInitialMigration(), new ModuleSettingsMigration()));
        $description = 'Module Manager installed. Applied: ' . ($applied ? implode(', ', $applied) : 'already current') . '.';

        $storage = new PackageStorage();
        if ($storage->available()) {
            $description .= ' Package storage: ' . $storage->root() . ' (' . $storage->describeSource() . ').';
            if ($storage->isInsideDocumentRoot()) {
                $description .= ' WARNING: that directory is inside the web root. Set ' . PackageStorage::ENV_VARIABLE . ' to a path outside the document root.';
            }
        } else {
            $description .= ' IMPORTANT: ' . $storage->unavailableReason();
        }
        if (!class_exists('ZipArchive')) {
            $description .= ' IMPORTANT: the PHP zip extension is not loaded, so packages cannot be inspected or installed.';
        }
        $description .= ' ' . CapabilityPolicy::describeSeeding(CapabilityPolicy::seedDefaults());
        return array('status' => 'success', 'description' => $description);
    } catch (\Throwable $error) {
        return array('status' => 'error', 'description' => $error->getMessage());
    }
}

function cloudhost247_modules_deactivate()
{
    return array(
        'status' => 'success',
        'description' => 'Data retained. Installed modules, their files, the package ledger, the installed-file manifest and the module log all remain in place; nothing was uninstalled or deleted.',
    );
}

function cloudhost247_modules_output($vars)
{
    $link = isset($vars['modulelink']) ? (string) $vars['modulelink'] : 'addonmodules.php?module=cloudhost247_modules';
    ModuleManager::registerIntegrations();
    $data = (new AdminController())->handle();
    echo (new AdminView($link))->render($data);
}
