<?php
namespace CloudHost247\ModuleManager\Install;

use CloudHost247\ModuleManager\Manifest\Manifest;
use CloudHost247\ModuleManager\Package\PackageInspection;
use CloudHost247\ModuleManager\Package\PackageStorage;
use CloudHost247\ModuleManager\Package\SecureExtractor;
use CloudHost247\ModuleManager\Registry\CompatibilityChecker;
use CloudHost247\ModuleManager\Registry\DependencyResolver;
use CloudHost247\ModuleManager\Registry\ModuleRegistry;
use CloudHost247\ModuleManager\Registry\ModuleRepository;
use CloudHost247\ModuleManager\Registry\UsageCensus;
use CloudHost247\ModuleManager\Support\Checksum;
use CloudHost247\ModuleManager\Support\ModuleException;
use CloudHost247\ModuleManager\Support\Paths;
use CloudHost247\ModuleManager\Support\Version;

/**
 * The real installation pipeline.
 *
 * Validate -> Inspect -> Compatibility -> Dependencies -> Security -> Preview
 * -> Confirm -> Backup -> Install -> Register -> Health check.
 *
 * Nothing reports success unless every step actually happened. A failure at
 * any point after the backup rolls the filesystem back and records the reason;
 * the registry row is only written once the files are on disk and verified.
 */
final class Installer
{
    private $repository;
    private $storage;
    private $extractor;
    private $compatibility;
    private $census;

    public function __construct(
        ModuleRegistry $repository = null,
        PackageStorage $storage = null,
        SecureExtractor $extractor = null,
        CompatibilityChecker $compatibility = null,
        UsageCensus $census = null
    ) {
        $this->repository = $repository ? $repository : new ModuleRepository();
        $this->storage = $storage ? $storage : new PackageStorage();
        $this->extractor = $extractor ? $extractor : new SecureExtractor();
        $this->compatibility = $compatibility ? $compatibility : new CompatibilityChecker();
        $this->census = $census ? $census : new UsageCensus();
    }

    public function repository() { return $this->repository; }
    public function compatibilityChecker() { return $this->compatibility; }
    public function storage() { return $this->storage; }

    /* ----------------------------------------------------------- preview -- */

    /**
     * Analyse a package against the live system. Writes nothing.
     *
     * @return InstallationPlan
     */
    public function plan(PackageInspection $inspection, $checksum, array $installedIndex = null, array $platform = array())
    {
        $manifest = $inspection->manifest();
        $existing = $this->repository->find($manifest->id());
        $existingVersion = $existing ? (string) $existing->version : '';

        $action = InstallationPlan::ACTION_INSTALL;
        if ($existing) {
            $direction = Version::compare($manifest->version(), $existingVersion);
            if ($direction > 0) { $action = InstallationPlan::ACTION_UPDATE; }
            elseif ($direction < 0) { $action = InstallationPlan::ACTION_DOWNGRADE; }
            else { $action = InstallationPlan::ACTION_REINSTALL; }
        }

        $compatibility = $this->compatibility->check($manifest);
        $installedIndex = $installedIndex === null ? $this->repository->installedIndex() : $installedIndex;
        $resolver = new DependencyResolver($installedIndex, $platform);
        $dependencies = $resolver->check($manifest);

        $files = $this->fileImpact($manifest, $inspection);
        $configurationChanges = $this->configurationChanges($manifest, $existing ? $this->repository->manifest($manifest->id()) : null);

        $warnings = array_merge($compatibility['warnings'], $dependencies['warnings']);
        $blockers = array_merge($compatibility['problems'], $dependencies['problems']);

        if ($existing && (string) $existing->module_type !== $manifest->type()) {
            $blockers[] = 'The installed module is a ' . $existing->module_type . ' module but the package declares type '
                . $manifest->type() . '. Uninstall the existing module before changing its type.';
        }
        if ($action === InstallationPlan::ACTION_DOWNGRADE) {
            $warnings[] = 'The uploaded version (' . $manifest->version() . ') is older than the installed version ('
                . $existingVersion . '). Downgrading can leave database changes from the newer version in place.';
        }
        if ($files['orphaned']) {
            $warnings[] = count($files['orphaned']) . ' file(s) present in the current installation are not in this package and will be removed.';
        }
        if ($manifest->hasMigrations()) {
            $warnings[] = 'This module declares database changes. Its own migration runs when the module is activated, not during file installation.';
        }
        if ($configurationChanges['removed']) {
            $warnings[] = count($configurationChanges['removed']) . ' configuration setting(s) declared by the installed version are gone from this package: '
                . implode(', ', $configurationChanges['removed']) . '. Their stored values are retained but no longer used.';
        }
        if (!$inspection->has($manifest->entryPoint())) {
            $blockers[] = 'The package does not contain its declared entry point "' . $manifest->entryPoint() . '".';
        }
        if (!$this->storage->available()) {
            $blockers[] = $this->storage->unavailableReason();
        }
        $writable = $this->destinationWritable($manifest);
        if ($writable !== '') { $blockers[] = $writable; }

        return new InstallationPlan(array(
            'inspection' => $inspection,
            'checksum' => (string) $checksum,
            'action' => $action,
            'existing_row' => $existing,
            'existing_version' => $existingVersion,
            'compatibility' => $compatibility,
            'dependencies' => $dependencies,
            'files' => $files,
            'warnings' => $warnings,
            'blockers' => $blockers,
            'integrations' => $manifest->integrationProviders(),
            'configuration_changes' => $configurationChanges,
        ));
    }

    /* ----------------------------------------------------------- install -- */

    /**
     * @return array array('action','module_id','version','previous_version','files','correlation_id','rolled_back')
     * @throws ModuleException
     */
    public function install(InstallationPlan $plan, $adminId)
    {
        if (!$plan->installable()) {
            throw new ModuleException('This package cannot be installed: ' . implode(' ', $plan->blockers()), ModuleException::REASON_COMPATIBILITY);
        }
        $manifest = $plan->manifest();
        $directory = Paths::moduleDirectory($manifest->type(), $manifest->id());
        $reference = date('Ymd-His') . '-' . substr($plan->checksum(), 0, 12);
        $backupDirectory = $this->storage->createBackupDirectory($manifest->id(), $reference);

        $transaction = new InstallationTransaction($backupDirectory, $directory);
        $transaction->begin(array(
            'module_id' => $manifest->id(),
            'module_name' => $manifest->name(),
            'module_type' => $manifest->type(),
            'action' => $plan->action(),
            'version_from' => $plan->existingVersion(),
            'version_to' => $manifest->version(),
            'package_checksum' => $plan->checksum(),
            'install_path' => $manifest->relativeDirectory(),
            'declared_tables' => $manifest->declaredTables(),
            'requires_configuration' => $manifest->requiresConfiguration(),
            // Configuration state before the change: stored setting keys only, never values.
            'configuration_keys_before' => array_keys($this->repository->settings($manifest->id())),
            'configuration_changes' => $plan->configurationChanges(),
            'integrations' => $manifest->integrationProviders(),
            'admin_id' => (int) $adminId,
        ));

        try {
            $transaction->clearDestination();
            $files = $this->extractor->extract($plan->inspection(), $directory);
            $transaction->markExtracted($files);
            $this->verifyInstalledTree($manifest, $directory, $files);

            $bytes = 0;
            foreach ($files as $file) { $bytes += (int) $file['bytes']; }

            $this->repository->recordInstallation($manifest, array(
                'checksum' => $plan->checksum(),
                'file_count' => count($files),
                'bytes' => $bytes,
            ), $adminId);
            $this->repository->replaceFileManifest($manifest->id(), $files);

            $transaction->commit(array('installed_files' => count($files), 'installed_bytes' => $bytes));

            return array(
                'action' => $plan->action(),
                'module_id' => $manifest->id(),
                'version' => $manifest->version(),
                'previous_version' => $plan->existingVersion(),
                'files' => count($files),
                'bytes' => $bytes,
                'backup' => basename($backupDirectory),
                'rolled_back' => false,
            );
        } catch (\Throwable $failure) {
            $reason = $failure instanceof ModuleException ? $failure->getMessage() : 'An unexpected error stopped the installation.';
            $restored = $transaction->rollback($reason);
            if ($plan->existingRow()) {
                // The registry still describes the previous version, which is what is back on disk.
                $this->repository->recordHealth($manifest->id(), 'unknown', 'Rolled back after a failed ' . $plan->action() . '.');
            }
            $message = $reason . ' The installation was rolled back'
                . ($plan->existingRow() ? ($restored ? ' and the previous version was restored.' : ', but the previous version could not be fully restored. Restore it from the backup directory before using this module.') : ' and no files were left behind.');
            throw new ModuleException($message, ModuleException::REASON_ROLLBACK);
        }
    }

    /**
     * What this package changes about the module's declared configuration.
     *
     * Recorded in the installation snapshot and shown in the update preview so
     * an administrator sees settings appearing, disappearing or changing shape
     * before confirming. Only field declarations are compared; stored values
     * are never read here.
     *
     * @return array array('added','removed','changed','requires_configuration')
     */
    private function configurationChanges(Manifest $manifest, Manifest $installed = null)
    {
        $describe = function (Manifest $source) {
            $fields = array();
            foreach ($source->configuration()['fields'] as $field) {
                $fields[$field['key']] = $field['type'] . '|' . ($field['required'] ? 'required' : 'optional')
                    . '|' . implode(',', $field['options']) . '|' . $field['min'] . '-' . $field['max'];
            }
            return $fields;
        };

        $new = $describe($manifest);
        $old = $installed ? $describe($installed) : array();

        $changed = array();
        foreach ($new as $key => $shape) {
            if (isset($old[$key]) && $old[$key] !== $shape) { $changed[] = $key; }
        }

        return array(
            'added' => array_values(array_diff(array_keys($new), array_keys($old))),
            'removed' => array_values(array_diff(array_keys($old), array_keys($new))),
            'changed' => $changed,
            'requires_configuration' => $manifest->requiresConfiguration(),
        );
    }

    /* --------------------------------------------------------- uninstall -- */

    /**
     * What an uninstall would actually do. Writes nothing.
     */
    public function uninstallImpact($moduleId, array $installedIndex = null)
    {
        $row = $this->repository->find($moduleId);
        if (!$row) {
            throw new ModuleException('That module is not installed.', ModuleException::REASON_STATE);
        }
        $manifest = $this->repository->manifest($moduleId);
        $files = $this->repository->files($moduleId);
        $installedIndex = $installedIndex === null ? $this->repository->installedIndex() : $installedIndex;
        $resolver = new DependencyResolver($installedIndex);

        $paths = array();
        foreach ($files as $file) { $paths[] = (string) $file->relative_path; }

        return array(
            'row' => $row,
            'manifest' => $manifest,
            'files' => $paths,
            'file_count' => count($paths),
            'directory' => $manifest ? $manifest->relativeDirectory() : (string) $row->install_path,
            'tables' => $manifest ? $manifest->declaredTables() : array(),
            'integrations' => $manifest ? $manifest->integrationProviders() : array(),
            'dependents' => $resolver->dependents($moduleId, true),
            'enabled' => (bool) $row->enabled,
            // Real WHMCS usage: servers, products, live customer services, domains.
            'usage' => $this->census->forModule($moduleId, (string) $row->module_type),
            'settings_retained' => count($this->repository->settings($moduleId)),
        );
    }

    /**
     * Remove exactly the files this installer recorded, then forget the module.
     * Database tables are always retained and reported, never dropped here.
     */
    public function uninstall($moduleId, $adminId)
    {
        $impact = $this->uninstallImpact($moduleId);
        if ($impact['dependents']) {
            $names = array();
            foreach ($impact['dependents'] as $dependent) { $names[] = $dependent['id']; }
            throw new ModuleException(
                'Cannot uninstall: ' . implode(', ', $names) . ' still depend(s) on this module. Uninstall or update the dependent module(s) first.',
                ModuleException::REASON_DEPENDENCY
            );
        }

        $row = $impact['row'];
        $directory = Paths::applicationRoot() . '/' . $impact['directory'];
        $removed = 0;
        $skipped = array();

        if (is_dir($directory)) {
            foreach ($impact['files'] as $relative) {
                $path = Paths::containedPath($directory, $relative);
                if ($path === false) { $skipped[] = $relative; continue; }
                if (is_file($path) && @unlink($path)) { $removed++; }
            }
            $this->removeEmptyDirectories($directory);
            // Only remove the module directory itself when the installer emptied it.
            if (Paths::listFiles($directory) === array()) {
                Paths::removeTree($directory, dirname($directory));
            } else {
                $skipped[] = 'files added after installation were left in place';
            }
        }

        $this->repository->forget($moduleId);

        return array(
            'module_id' => $moduleId,
            'version' => (string) $row->version,
            'removed' => $removed,
            'retained_tables' => $impact['tables'],
            'skipped' => $skipped,
        );
    }

    /* ------------------------------------------------------ enable/disable */

    public function assertCanDisable($moduleId, array $installedIndex = null)
    {
        $installedIndex = $installedIndex === null ? $this->repository->installedIndex() : $installedIndex;
        $resolver = new DependencyResolver($installedIndex);
        $dependents = $resolver->dependents($moduleId, false);
        if ($dependents) {
            $names = array();
            foreach ($dependents as $dependent) { $names[] = $dependent['id']; }
            throw new ModuleException(
                'Disabling this module would break ' . implode(', ', $names) . ', which depend(s) on it. Disable the dependent module(s) first.',
                ModuleException::REASON_DEPENDENCY
            );
        }
        return true;
    }

    public function assertCanEnable($moduleId, array $installedIndex = null, array $platform = array())
    {
        $manifest = $this->repository->manifest($moduleId);
        if (!$manifest) {
            throw new ModuleException('This module has no valid manifest and cannot be enabled.', ModuleException::REASON_STATE);
        }
        $installedIndex = $installedIndex === null ? $this->repository->installedIndex() : $installedIndex;
        unset($installedIndex[$moduleId]);
        $resolver = new DependencyResolver($installedIndex, $platform);
        $dependencies = $resolver->check($manifest);
        if (!$dependencies['satisfied']) {
            throw new ModuleException('Cannot enable this module: ' . implode(' ', $dependencies['problems']), ModuleException::REASON_DEPENDENCY);
        }
        $compatibility = $this->compatibility->check($manifest);
        if (!$compatibility['compatible']) {
            throw new ModuleException('Cannot enable this module: ' . implode(' ', $compatibility['problems']), ModuleException::REASON_COMPATIBILITY);
        }
        $health = $this->health($moduleId);
        if ($health['status'] === 'missing_files') {
            throw new ModuleException('Cannot enable this module: ' . $health['detail'], ModuleException::REASON_STATE);
        }
        return true;
    }

    /* ------------------------------------------------------- health check */

    /**
     * Verify the module on disk still matches what was installed.
     *
     * @return array array('status','detail','checked','missing','modified')
     */
    public function health($moduleId)
    {
        $row = $this->repository->find($moduleId);
        if (!$row) {
            return array('status' => 'not_installed', 'detail' => 'No installation record exists for this module.', 'checked' => 0, 'missing' => array(), 'modified' => array());
        }
        $directory = Paths::applicationRoot() . '/' . (string) $row->install_path;
        if (!is_dir($directory)) {
            return array('status' => 'missing_files', 'detail' => 'The module directory is missing from the filesystem.', 'checked' => 0, 'missing' => array(), 'modified' => array());
        }

        $missing = array();
        $modified = array();
        $checked = 0;
        foreach ($this->repository->files($moduleId) as $file) {
            $path = Paths::containedPath($directory, (string) $file->relative_path);
            if ($path === false || !is_file($path)) { $missing[] = (string) $file->relative_path; continue; }
            $checked++;
            if ((string) $file->sha256 === '') { continue; }
            if (!Checksum::matches((string) $file->sha256, Checksum::ofFile($path))) {
                $modified[] = (string) $file->relative_path;
            }
        }

        if ($missing) {
            return array(
                'status' => 'missing_files',
                'detail' => count($missing) . ' installed file(s) are missing from disk, including "' . $missing[0] . '".',
                'checked' => $checked, 'missing' => $missing, 'modified' => $modified,
            );
        }
        if ($modified) {
            return array(
                'status' => 'modified',
                'detail' => count($modified) . ' installed file(s) differ from the installed package. Reinstall to restore them.',
                'checked' => $checked, 'missing' => $missing, 'modified' => $modified,
            );
        }
        return array(
            'status' => 'healthy',
            'detail' => $checked . ' file(s) verified against the installed package checksum.',
            'checked' => $checked, 'missing' => array(), 'modified' => array(),
        );
    }

    /* ----------------------------------------------------------- internals */

    private function fileImpact(Manifest $manifest, PackageInspection $inspection)
    {
        $directory = Paths::moduleDirectory($manifest->type(), $manifest->id());
        $incoming = $inspection->crcMap();
        $existing = is_dir($directory) ? Paths::listFiles($directory) : array();
        $existingSet = array_flip($existing);

        $new = array();
        $replaced = array();
        $unchanged = array();
        foreach ($incoming as $relative => $crc) {
            if (!isset($existingSet[$relative])) { $new[] = $relative; continue; }
            $path = $directory . '/' . $relative;
            $current = @hash_file('crc32b', $path);
            if ($current !== false && hexdec($current) === (int) sprintf('%u', $crc)) {
                $unchanged[] = $relative;
            } else {
                $replaced[] = $relative;
            }
        }
        $orphaned = array_values(array_diff($existing, array_keys($incoming)));
        sort($new); sort($replaced); sort($unchanged); sort($orphaned);

        return array(
            'new' => $new,
            'replaced' => $replaced,
            'unchanged' => $unchanged,
            'orphaned' => $orphaned,
            'total' => count($incoming),
        );
    }

    private function destinationWritable(Manifest $manifest)
    {
        $parent = Paths::applicationRoot() . '/' . \CloudHost247\ModuleManager\Support\ModuleType::directory($manifest->type());
        if (!is_dir($parent)) {
            if (!Paths::ensureDirectory($parent, 0755)) {
                return 'The destination directory ' . \CloudHost247\ModuleManager\Support\ModuleType::directory($manifest->type()) . ' does not exist and could not be created.';
            }
        }
        if (!is_writable($parent)) {
            return 'The destination directory ' . \CloudHost247\ModuleManager\Support\ModuleType::directory($manifest->type()) . ' is not writable by the web server user.';
        }
        $directory = Paths::moduleDirectory($manifest->type(), $manifest->id());
        if (is_link($directory)) {
            return 'The destination path is a symbolic link and will not be written to.';
        }
        if (is_dir($directory) && !is_writable($directory)) {
            return 'The existing module directory is not writable, so it cannot be replaced.';
        }
        return '';
    }

    private function verifyInstalledTree(Manifest $manifest, $directory, array $files)
    {
        $entry = Paths::containedPath($directory, $manifest->entryPoint());
        if ($entry === false || !is_file($entry)) {
            throw new ModuleException('The declared entry point was not present after extraction.', ModuleException::REASON_INSTALL);
        }
        foreach ($manifest->healthCheckFiles() as $required) {
            $path = Paths::containedPath($directory, $required);
            if ($path === false || !is_file($path)) {
                throw new ModuleException('A file the manifest declares as required ("' . $required . '") is missing after extraction.', ModuleException::REASON_INSTALL);
            }
        }
        if (!$files) {
            throw new ModuleException('No files were written during extraction.', ModuleException::REASON_INSTALL);
        }
    }

    private function removeEmptyDirectories($directory)
    {
        $entries = @scandir($directory);
        if ($entries === false) { return; }
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') { continue; }
            $path = $directory . '/' . $entry;
            if (is_dir($path) && !is_link($path)) {
                $this->removeEmptyDirectories($path);
                @rmdir($path);
            }
        }
    }
}
