<?php
namespace CloudHost247\ModuleManager\Install;

use CloudHost247\ModuleManager\Package\PackageInspection;

/**
 * Everything the administrator is shown before confirming an installation.
 *
 * A plan is pure analysis: building one writes nothing and changes nothing.
 * The installer refuses to run from anything other than a plan, so what the
 * preview describes is exactly what will be attempted.
 */
final class InstallationPlan
{
    const ACTION_INSTALL = 'install';
    const ACTION_UPDATE = 'update';
    const ACTION_DOWNGRADE = 'downgrade';
    const ACTION_REINSTALL = 'reinstall';

    private $data;

    public function __construct(array $data)
    {
        $this->data = $data;
    }

    /** @return PackageInspection */
    public function inspection() { return $this->data['inspection']; }
    public function manifest() { return $this->data['inspection']->manifest(); }
    public function checksum() { return $this->data['checksum']; }
    public function action() { return $this->data['action']; }
    public function existingVersion() { return $this->data['existing_version']; }
    public function existingRow() { return $this->data['existing_row']; }
    public function compatibility() { return $this->data['compatibility']; }
    public function dependencies() { return $this->data['dependencies']; }
    public function files() { return $this->data['files']; }
    public function warnings() { return $this->data['warnings']; }
    public function blockers() { return $this->data['blockers']; }
    public function integrations() { return $this->data['integrations']; }
    public function configurationChanges() { return isset($this->data['configuration_changes']) ? $this->data['configuration_changes'] : array('added' => array(), 'removed' => array(), 'changed' => array(), 'requires_configuration' => false); }
    public function requiresDowngradeConfirmation() { return $this->action() === self::ACTION_DOWNGRADE; }

    public function actionLabel()
    {
        $labels = array(
            self::ACTION_INSTALL => 'Install Module',
            self::ACTION_UPDATE => 'Update Module',
            self::ACTION_DOWNGRADE => 'Downgrade Module',
            self::ACTION_REINSTALL => 'Reinstall Module',
        );
        return isset($labels[$this->action()]) ? $labels[$this->action()] : 'Install Module';
    }

    public function isFreshInstall()
    {
        return $this->action() === self::ACTION_INSTALL;
    }

    /** True only when nothing blocks the installation. */
    public function installable()
    {
        return $this->blockers() === array();
    }

    public function databaseChanges()
    {
        return $this->manifest()->hasMigrations();
    }

    public function declaredTables()
    {
        return $this->manifest()->declaredTables();
    }

    public function requiresConfiguration()
    {
        return $this->manifest()->requiresConfiguration();
    }

    public function fileCount()
    {
        return $this->inspection()->fileCount();
    }

    public function summary()
    {
        $manifest = $this->manifest();
        return array(
            'module' => $manifest->name(),
            'module_id' => $manifest->id(),
            'version' => $manifest->version(),
            'existing_version' => $this->existingVersion(),
            'author' => $manifest->author(),
            'license' => $manifest->license(),
            'type' => $manifest->typeLabel(),
            'php' => $manifest->phpRange(),
            'install_path' => $manifest->relativeDirectory(),
            'files' => $this->fileCount(),
            'size' => $this->inspection()->humanSize(),
            'database_changes' => $this->databaseChanges() ? 'Yes' : 'No',
            'configuration_required' => $this->requiresConfiguration() ? 'Yes' : 'No',
            'permissions' => $manifest->permissions(),
            'checksum' => $this->checksum(),
        );
    }
}
