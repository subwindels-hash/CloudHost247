<?php
namespace CloudHost247\ModuleManager\Services;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\Logger;
use CloudHost247\Foundation\Support\SafeError;
use CloudHost247\ModuleManager\Install\Installer;
use CloudHost247\ModuleManager\Package\ArchiveInspector;
use CloudHost247\ModuleManager\Package\PackageStorage;
use CloudHost247\ModuleManager\Package\UploadReceiver;
use CloudHost247\ModuleManager\Registry\CompatibilityChecker;
use CloudHost247\ModuleManager\Security\CapabilityPolicy;
use CloudHost247\ModuleManager\Registry\ModuleRegistry;
use CloudHost247\ModuleManager\Registry\ModuleRepository;
use CloudHost247\ModuleManager\Support\Checksum;
use CloudHost247\ModuleManager\Support\ModuleException;
use CloudHost247\ModuleManager\Support\ModuleType;

/**
 * Super Admin controller for the Module Manager.
 *
 * Installing a module puts executable code on the server, so every entry point
 * is treated as a privileged security operation: authenticated administrator,
 * per-operation capability, CSRF token, explicit confirmation for anything
 * destructive, and an audit record of the outcome either way.
 */
final class AdminController
{
    const MODULE = 'cloudhost247_modules';

    /** Capability set, seeded Super-Admin-only at activation. */
    const CAPABILITIES = CapabilityPolicy::CAPABILITIES;

    private $repository;
    private $installer;
    private $storage;
    private $inspector;
    private $receiver;

    public function __construct(
        ModuleRegistry $repository = null,
        Installer $installer = null,
        PackageStorage $storage = null,
        ArchiveInspector $inspector = null,
        UploadReceiver $receiver = null
    ) {
        $this->repository = $repository ? $repository : new ModuleRepository();
        $this->storage = $storage ? $storage : new PackageStorage();
        $this->installer = $installer ? $installer : new Installer($this->repository, $this->storage);
        $this->inspector = $inspector ? $inspector : new ArchiveInspector();
        $this->receiver = $receiver ? $receiver : new UploadReceiver();
    }

    public function handle()
    {
        $adminId = AdminGuard::requireAdmin();
        AdminGuard::requireCapability(self::MODULE, 'modules.view');

        $notice = '';
        $error = '';
        $preview = null;

        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') === 'POST') {
            try {
                AdminGuard::requirePostToken();
                $outcome = $this->dispatch(isset($_POST['operation']) ? (string) $_POST['operation'] : '', $adminId);
                $notice = isset($outcome['notice']) ? $outcome['notice'] : '';
                $preview = isset($outcome['preview']) ? $outcome['preview'] : null;
            } catch (ModuleException $failure) {
                $error = $failure->getMessage();
            } catch (\InvalidArgumentException $invalid) {
                $error = $invalid->getMessage();
            } catch (\Throwable $unexpected) {
                $safe = SafeError::from($unexpected, self::MODULE, 'admin.operation', 'The requested module operation could not be completed.');
                $error = $safe['display'];
            }
        }

        $view = $this->selectedView($preview !== null);
        $compatibility = new CompatibilityChecker();

        $data = array(
            'view' => $view,
            'notice' => $notice,
            'error' => $error,
            'preview' => $preview,
            'token' => function_exists('generate_token') ? generate_token('plain') : '',
            'storage' => $this->storage->report(),
            'max_upload' => UploadReceiver::maxBytes(),
            'php_version' => $compatibility->phpVersion(),
            'application_version' => $compatibility->applicationVersion(),
            'module_types' => ModuleType::all(),
            'capabilities' => self::CAPABILITIES,
            'permitted' => $this->permitted(),
            'modules' => $this->overview(),
            'zip_available' => class_exists('ZipArchive'),
        );

        if ($view === 'packages') {
            $data['packages'] = $this->repository->packages(50);
        }
        if ($view === 'logs') {
            $filters = array();
            foreach (array('module_id', 'event_type', 'result') as $filter) {
                if (!empty($_GET[$filter])) { $filters[$filter] = (string) $_GET[$filter]; }
            }
            $data['events'] = $this->repository->events($filters, isset($_GET['event_page']) ? $_GET['event_page'] : 1);
            $data['event_filters'] = $filters;
            $data['event_types'] = ModuleRepository::EVENT_TYPES;
        }
        if ($view === 'details') {
            $moduleId = isset($_GET['module']) ? (string) $_GET['module'] : '';
            $row = $this->repository->find($moduleId);
            if ($row) {
                $data['module'] = $row;
                $data['manifest'] = $this->repository->manifest($moduleId);
                $data['files'] = $this->repository->files($moduleId);
                $data['health'] = $this->installer->health($moduleId);
                $data['integration_status'] = ModuleManager::integrationStatus($moduleId);
                $data['module_events'] = $this->repository->events(array('module_id' => $moduleId), 1, 15);
                try {
                    $data['uninstall_impact'] = $this->installer->uninstallImpact($moduleId);
                } catch (ModuleException $ignored) {
                    $data['uninstall_impact'] = null;
                }
            } else {
                $data['view'] = 'dashboard';
            }
        }
        return $data;
    }

    /* ---------------------------------------------------------- operations */

    private function dispatch($operation, $adminId)
    {
        switch ($operation) {
            case 'upload':
                return $this->upload($adminId);
            case 'preview':
                return $this->preview($adminId);
            case 'install':
                return $this->install($adminId);
            case 'toggle':
                return $this->toggle($adminId);
            case 'uninstall':
                return $this->uninstall($adminId);
            case 'verify':
                return $this->verify($adminId);
            case 'discard':
                return $this->discard($adminId);
            default:
                throw new \InvalidArgumentException('Unknown module operation.');
        }
    }

    /** Upload -> validate -> inspect -> record. Nothing is installed here. */
    private function upload($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'modules.upload');
        if (!$this->storage->available()) {
            throw new ModuleException($this->storage->unavailableReason(), ModuleException::REASON_STORAGE);
        }

        $received = $this->receiver->receive(isset($_FILES['package']) ? $_FILES['package'] : null);
        $checksum = $received['checksum'];

        try {
            $inspection = $this->inspector->inspect($received['path']);
        } catch (ModuleException $rejected) {
            $this->repository->recordPackage(array(
                'checksum' => $checksum,
                'original_name' => $received['name'],
                'size_bytes' => $received['bytes'],
                'status' => 'rejected',
                'rejected_reason' => $rejected->getMessage(),
                'uploaded_by' => $adminId,
            ));
            $correlation = $this->log($adminId, 'reject', '', 'failed', $rejected->getMessage(), $checksum);
            $this->audit($adminId, 'module.package.rejected', $received['name'], array('checksum' => $checksum), array('reason' => $rejected->reason()), 'failed', $rejected->getMessage());
            throw $rejected->withCorrelation($correlation);
        }

        $manifest = $inspection->manifest();
        $stored = $this->storage->store($received['path'], $checksum);

        $this->repository->recordPackage(array(
            'checksum' => $checksum,
            'original_name' => $received['name'],
            'size_bytes' => $received['bytes'],
            'module_id' => $manifest->id(),
            'module_name' => $manifest->name(),
            'version' => $manifest->version(),
            'module_type' => $manifest->type(),
            'status' => 'validated',
            'file_count' => $inspection->fileCount(),
            'inspection_json' => json_encode(array(
                'root_prefix' => $inspection->rootPrefix(),
                'files' => $inspection->fileCount(),
                'bytes' => $inspection->totalBytes(),
                'stored' => basename($stored),
            )),
            'rejected_reason' => '',
            'uploaded_by' => $adminId,
        ));

        $this->log($adminId, 'upload', $manifest->id(), 'success', $manifest->name() . ' ' . $manifest->version() . ' accepted for review.', $checksum);
        $this->audit($adminId, 'module.package.uploaded', $manifest->id(), array(), array(
            'version' => $manifest->version(), 'type' => $manifest->type(), 'checksum' => $checksum, 'files' => $inspection->fileCount(),
        ));

        return array(
            'notice' => 'Package accepted: ' . $manifest->name() . ' ' . $manifest->version() . '. Review the installation preview below before installing.',
            'preview' => $this->buildPreview($checksum),
        );
    }

    /** Re-open a stored package and rebuild its preview. */
    private function preview($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'modules.view');
        $checksum = $this->postChecksum();
        return array('notice' => '', 'preview' => $this->buildPreview($checksum));
    }

    private function install($adminId)
    {
        $checksum = $this->postChecksum();
        $preview = $this->buildPreview($checksum);
        $plan = $preview['plan'];
        $manifest = $plan->manifest();

        AdminGuard::requireCapability(self::MODULE, $plan->isFreshInstall() ? 'modules.install' : 'modules.update');

        if (empty($_POST['confirm_install'])) {
            throw new ModuleException('Installation requires explicit confirmation.', ModuleException::REASON_PERMISSION);
        }
        if ($plan->requiresDowngradeConfirmation() && empty($_POST['confirm_downgrade'])) {
            throw new ModuleException('This package is older than the installed version. Confirm the downgrade to continue.', ModuleException::REASON_PERMISSION);
        }
        if (!$plan->installable()) {
            $reason = implode(' ', $plan->blockers());
            $this->log($adminId, 'install', $manifest->id(), 'failed', $reason, $checksum);
            $this->audit($adminId, 'module.install', $manifest->id(), array(), array('version' => $manifest->version()), 'failed', $reason);
            throw new ModuleException('This package cannot be installed: ' . $reason, ModuleException::REASON_COMPATIBILITY);
        }

        try {
            $result = $this->installer->install($plan, $adminId);
        } catch (ModuleException $failure) {
            $correlation = $this->log($adminId, 'rollback', $manifest->id(), 'failed', $failure->getMessage(), $checksum, $plan->existingVersion(), $manifest->version());
            $this->audit($adminId, 'module.install', $manifest->id(), array('version' => $plan->existingVersion()), array('version' => $manifest->version()), 'failed', $failure->getMessage());
            throw $failure->withCorrelation($correlation);
        }

        $eventType = $plan->action() === 'install' ? 'install' : ($plan->action() === 'reinstall' ? 'reinstall' : 'update');
        $this->repository->setPackageStatus($checksum, 'installed');
        $this->log(
            $adminId, $eventType, $manifest->id(), 'success',
            $result['files'] . ' file(s) installed to ' . $manifest->relativeDirectory() . '.',
            $checksum, $result['previous_version'], $result['version']
        );
        $this->audit($adminId, 'module.' . $eventType, $manifest->id(), array('version' => $result['previous_version']), array(
            'version' => $result['version'], 'files' => $result['files'], 'checksum' => $checksum, 'path' => $manifest->relativeDirectory(),
        ));

        $health = ModuleManager::verify($manifest->id(), $this->installer);
        $this->log($adminId, 'health_check', $manifest->id(), $health['status'] === 'healthy' ? 'success' : 'failed', $health['detail'], $checksum);

        $notice = $manifest->name() . ' ' . $manifest->version() . ' ' . ($plan->isFreshInstall() ? 'installed' : 'updated')
            . ': ' . $result['files'] . ' file(s) written to ' . $manifest->relativeDirectory() . '. '
            . 'Post-install verification: ' . $health['detail'] . ' The module is installed but disabled — enable it once you have reviewed its configuration.';
        return array('notice' => $notice);
    }

    private function toggle($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'modules.toggle');
        $moduleId = $this->postModuleId();
        $row = $this->repository->find($moduleId);
        if (!$row) { throw new ModuleException('That module is not installed.', ModuleException::REASON_STATE); }
        $enable = !empty($_POST['enabled']);

        if ($enable) {
            $this->installer->assertCanEnable($moduleId, null, ModuleManager::platformComponents());
        } else {
            $this->installer->assertCanDisable($moduleId);
        }
        $this->repository->setEnabled($moduleId, $enable, $adminId);

        $this->log($adminId, $enable ? 'enable' : 'disable', $moduleId, 'success', $enable ? 'Module enabled.' : 'Module disabled. Files and data were retained.', (string) $row->package_checksum);
        $this->audit($adminId, $enable ? 'module.enable' : 'module.disable', $moduleId, array('enabled' => (bool) $row->enabled), array('enabled' => $enable));

        return array('notice' => $enable
            ? $row->name . ' is now enabled.'
            : $row->name . ' is now disabled. No files were deleted and no database data was removed.');
    }

    private function uninstall($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'modules.uninstall');
        $moduleId = $this->postModuleId();
        $impact = $this->installer->uninstallImpact($moduleId);
        $confirmation = isset($_POST['confirm_module_id']) ? trim((string) $_POST['confirm_module_id']) : '';
        if ($confirmation !== $moduleId) {
            throw new ModuleException('Type the module id exactly to confirm the uninstall.', ModuleException::REASON_PERMISSION);
        }
        if (empty($_POST['confirm_uninstall'])) {
            throw new ModuleException('Uninstalling requires explicit confirmation.', ModuleException::REASON_PERMISSION);
        }

        try {
            $result = $this->installer->uninstall($moduleId, $adminId);
        } catch (ModuleException $failure) {
            $correlation = $this->log($adminId, 'uninstall', $moduleId, 'failed', $failure->getMessage(), (string) $impact['row']->package_checksum);
            $this->audit($adminId, 'module.uninstall', $moduleId, array('version' => (string) $impact['row']->version), array(), 'failed', $failure->getMessage());
            throw $failure->withCorrelation($correlation);
        }

        $retained = $result['retained_tables']
            ? ' Database tables retained: ' . implode(', ', $result['retained_tables']) . '.'
            : ' This module declared no database tables.';
        $this->log($adminId, 'uninstall', $moduleId, 'success', $result['removed'] . ' file(s) removed.' . $retained, (string) $impact['row']->package_checksum, $result['version'], '');
        $this->audit($adminId, 'module.uninstall', $moduleId, array('version' => $result['version'], 'files' => $impact['file_count']), array('removed' => $result['removed'], 'retained_tables' => $result['retained_tables']));

        return array('notice' => $impact['row']->name . ' was uninstalled: ' . $result['removed'] . ' file(s) removed.' . $retained
            . ' Customer and service data were not deleted.');
    }

    private function verify($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'modules.view');
        $moduleId = $this->postModuleId();
        $health = ModuleManager::verify($moduleId, $this->installer);
        $this->log($adminId, 'health_check', $moduleId, $health['status'] === 'healthy' ? 'success' : 'failed', $health['detail']);
        return array('notice' => 'Verification complete: ' . $health['detail']);
    }

    private function discard($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'modules.upload');
        $checksum = $this->postChecksum();
        $this->storage->forget($checksum);
        $this->repository->forgetPackage($checksum);
        $this->audit($adminId, 'module.package.discarded', Checksum::short($checksum), array('checksum' => $checksum), array());
        return array('notice' => 'The uploaded package was deleted from storage.');
    }

    /* ------------------------------------------------------------ helpers */

    private function buildPreview($checksum)
    {
        $path = $this->storage->packagePath($checksum);
        if ($path === '') {
            throw new ModuleException('That package is no longer available in storage. Upload it again.', ModuleException::REASON_STATE);
        }
        if (!Checksum::matches($checksum, Checksum::ofFile($path))) {
            $this->repository->setPackageStatus($checksum, 'rejected', 'Stored package checksum mismatch.');
            throw new ModuleException('The stored package no longer matches its recorded checksum and will not be installed.', ModuleException::REASON_ARCHIVE);
        }
        $inspection = $this->inspector->inspect($path);
        $plan = $this->installer->plan($inspection, $checksum, null, ModuleManager::platformComponents());
        return array('plan' => $plan, 'summary' => $plan->summary());
    }

    /** What this administrator's role may actually do, so the UI never offers a forbidden action. */
    private function permitted()
    {
        $permitted = array();
        foreach (CapabilityPolicy::keys() as $capability) {
            $permitted[$capability] = CapabilityPolicy::allows($capability);
        }
        $permitted['modules.view'] = true; // already enforced before this point
        return $permitted;
    }

    private function overview()
    {
        $rows = array();
        foreach ($this->repository->all() as $row) {
            $rows[] = array(
                'row' => $row,
                'type_label' => ModuleType::label((string) $row->module_type),
                'present' => is_dir(\CloudHost247\ModuleManager\Support\Paths::applicationRoot() . '/' . (string) $row->install_path),
            );
        }
        return $rows;
    }

    private function selectedView($hasPreview)
    {
        if ($hasPreview) { return 'preview'; }
        $view = isset($_GET['view']) ? (string) $_GET['view'] : 'dashboard';
        $allowed = array('dashboard', 'upload', 'packages', 'logs', 'details');
        return in_array($view, $allowed, true) ? $view : 'dashboard';
    }

    private function postChecksum()
    {
        $checksum = isset($_POST['checksum']) ? (string) $_POST['checksum'] : '';
        if (!preg_match('/^[0-9a-f]{64}$/', $checksum)) {
            throw new \InvalidArgumentException('A valid package reference is required.');
        }
        return $checksum;
    }

    private function postModuleId()
    {
        $moduleId = isset($_POST['module_id']) ? (string) $_POST['module_id'] : '';
        if (!\CloudHost247\ModuleManager\Support\Paths::isValidModuleId($moduleId)) {
            throw new \InvalidArgumentException('A valid module reference is required.');
        }
        return $moduleId;
    }

    private function log($adminId, $type, $moduleId, $result, $detail, $checksum = '', $from = '', $to = '')
    {
        return $this->repository->recordEvent(array(
            'module_id' => $moduleId,
            'event_type' => $type,
            'result' => $result,
            'version_from' => $from,
            'version_to' => $to,
            'package_checksum' => $checksum,
            'detail' => $detail,
            'admin_id' => $adminId,
            'admin_ip' => self::clientAddress(),
            'correlation_id' => Logger::correlationId(),
        ));
    }

    private function audit($adminId, $action, $resourceId, array $before, array $after, $result = 'success', $failureReason = null)
    {
        AuditLogger::record(self::MODULE, $action, 'module', $resourceId, $before, $after, $result, $failureReason, $adminId);
    }

    /** Only the direct peer address is recorded; forwarded headers are not trusted. */
    public static function clientAddress()
    {
        $address = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        return filter_var($address, FILTER_VALIDATE_IP) ? $address : '';
    }
}
