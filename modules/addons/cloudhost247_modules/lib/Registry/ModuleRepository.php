<?php
namespace CloudHost247\ModuleManager\Registry;

use CloudHost247\Foundation\Support\Logger;
use CloudHost247\ModuleManager\Manifest\Manifest;
use CloudHost247\ModuleManager\Support\ModuleException;
use WHMCS\Database\Capsule;

/**
 * The only class that reads or writes Module Manager state.
 *
 * Installed modules, uploaded packages, the per-file installation manifest and
 * the lifecycle log all live behind this repository so the recorded state can
 * never drift from what the installer actually did.
 */
final class ModuleRepository implements ModuleRegistry
{
    const MODULES = 'mod_cloudhost247_modules';
    const PACKAGES = 'mod_cloudhost247_module_packages';
    const FILES = 'mod_cloudhost247_module_files';
    const EVENTS = 'mod_cloudhost247_module_events';
    const SETTINGS = 'mod_cloudhost247_module_settings';

    const EVENT_TYPES = array(
        'upload' => 'Package uploaded',
        'reject' => 'Package rejected',
        'install' => 'Module installed',
        'update' => 'Module updated',
        'reinstall' => 'Module reinstalled',
        'enable' => 'Module enabled',
        'disable' => 'Module disabled',
        'uninstall' => 'Module uninstalled',
        'rollback' => 'Installation rolled back',
        'health_check' => 'Health check',
        'configure' => 'Configuration changed',
    );

    /* ------------------------------------------------------------- modules */

    public function all()
    {
        return Capsule::table(self::MODULES)->orderBy('module_type')->orderBy('module_id')->get();
    }

    public function find($moduleId)
    {
        return Capsule::table(self::MODULES)->where('module_id', (string) $moduleId)->first();
    }

    /** module_id => array('version','enabled','name','dependencies') for the dependency resolver. */
    public function installedIndex()
    {
        $index = array();
        foreach ($this->all() as $row) {
            $manifest = $this->manifestArray($row);
            $index[$row->module_id] = array(
                'version' => (string) $row->version,
                'enabled' => (bool) $row->enabled,
                'name' => (string) $row->name,
                'dependencies' => isset($manifest['dependencies']) ? (array) $manifest['dependencies'] : array(),
            );
        }
        return $index;
    }

    public function manifestArray($row)
    {
        if (!$row || empty($row->manifest_json)) { return array(); }
        $decoded = json_decode((string) $row->manifest_json, true);
        return is_array($decoded) ? $decoded : array();
    }

    /** @return Manifest|null */
    public function manifest($moduleId)
    {
        $row = $this->find($moduleId);
        $data = $this->manifestArray($row);
        if (!$data) { return null; }
        try {
            return Manifest::fromArray($data);
        } catch (ModuleException $invalid) {
            return null;
        }
    }

    public function recordInstallation(Manifest $manifest, array $facts, $adminId)
    {
        $now = date('Y-m-d H:i:s');
        $existing = $this->find($manifest->id());
        $attributes = array(
            'name' => $manifest->name(),
            'version' => $manifest->version(),
            'module_type' => $manifest->type(),
            'author' => $manifest->author(),
            'license' => $manifest->license(),
            'description' => $manifest->description(),
            'entry_point' => $manifest->entryPoint(),
            'install_path' => $manifest->relativeDirectory(),
            'status' => 'installed',
            'manifest_json' => $manifest->toJson(),
            'package_checksum' => isset($facts['checksum']) ? (string) $facts['checksum'] : '',
            'file_count' => isset($facts['file_count']) ? (int) $facts['file_count'] : 0,
            'installed_bytes' => isset($facts['bytes']) ? (int) $facts['bytes'] : 0,
            'updated_by' => $adminId,
            'updated_at' => $now,
            // A freshly installed or updated module has not been verified yet.
            'health_status' => 'unknown',
            'health_detail' => '',
            'health_checked_at' => null,
        );
        if ($existing) {
            $attributes['previous_version'] = (string) $existing->version;
            Capsule::table(self::MODULES)->where('module_id', $manifest->id())->update($attributes);
            return (int) $existing->id;
        }
        $attributes['module_id'] = $manifest->id();
        $attributes['enabled'] = false; // never auto-enable an installed module
        $attributes['installed_by'] = $adminId;
        $attributes['installed_at'] = $now;
        $attributes['previous_version'] = '';
        return (int) Capsule::table(self::MODULES)->insertGetId($attributes);
    }

    public function setEnabled($moduleId, $enabled, $adminId)
    {
        Capsule::table(self::MODULES)->where('module_id', (string) $moduleId)->update(array(
            'enabled' => $enabled ? 1 : 0,
            'status' => $enabled ? 'installed' : 'disabled',
            'updated_by' => $adminId,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function markFailed($moduleId, $detail)
    {
        Capsule::table(self::MODULES)->where('module_id', (string) $moduleId)->update(array(
            'status' => 'failed',
            'enabled' => 0,
            'health_status' => 'failed',
            'health_detail' => substr((string) $detail, 0, 255),
            'health_checked_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function recordHealth($moduleId, $status, $detail)
    {
        Capsule::table(self::MODULES)->where('module_id', (string) $moduleId)->update(array(
            'health_status' => substr((string) $status, 0, 32),
            'health_detail' => substr((string) $detail, 0, 255),
            'health_checked_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function forget($moduleId)
    {
        Capsule::table(self::FILES)->where('module_id', (string) $moduleId)->delete();
        Capsule::table(self::MODULES)->where('module_id', (string) $moduleId)->delete();
    }

    /* ------------------------------------------------------------ packages */

    public function recordPackage(array $attributes)
    {
        $checksum = (string) $attributes['checksum'];
        $existing = Capsule::table(self::PACKAGES)->where('checksum', $checksum)->first();
        $attributes['uploaded_at'] = date('Y-m-d H:i:s');
        if ($existing) {
            Capsule::table(self::PACKAGES)->where('checksum', $checksum)->update($attributes);
            return (int) $existing->id;
        }
        return (int) Capsule::table(self::PACKAGES)->insertGetId($attributes);
    }

    public function packages($limit = 50)
    {
        return Capsule::table(self::PACKAGES)->orderBy('uploaded_at', 'desc')->limit(max(1, (int) $limit))->get();
    }

    public function package($checksum)
    {
        if (!preg_match('/^[0-9a-f]{64}$/', (string) $checksum)) { return null; }
        return Capsule::table(self::PACKAGES)->where('checksum', (string) $checksum)->first();
    }

    public function setPackageStatus($checksum, $status, $reason = '')
    {
        Capsule::table(self::PACKAGES)->where('checksum', (string) $checksum)->update(array(
            'status' => substr((string) $status, 0, 24),
            'rejected_reason' => substr((string) $reason, 0, 500),
        ));
    }

    public function forgetPackage($checksum)
    {
        Capsule::table(self::PACKAGES)->where('checksum', (string) $checksum)->delete();
    }

    /* --------------------------------------------------------------- files */

    public function replaceFileManifest($moduleId, array $files)
    {
        Capsule::table(self::FILES)->where('module_id', (string) $moduleId)->delete();
        $now = date('Y-m-d H:i:s');
        foreach (array_chunk($files, 200) as $chunk) {
            $rows = array();
            foreach ($chunk as $file) {
                $rows[] = array(
                    'module_id' => (string) $moduleId,
                    'relative_path' => substr((string) $file['path'], 0, 255),
                    'sha256' => isset($file['sha256']) ? (string) $file['sha256'] : '',
                    'bytes' => isset($file['bytes']) ? (int) $file['bytes'] : 0,
                    'action' => isset($file['action']) ? (string) $file['action'] : 'created',
                    'backup_name' => isset($file['backup_name']) ? substr((string) $file['backup_name'], 0, 191) : '',
                    'created_at' => $now,
                );
            }
            if ($rows) { Capsule::table(self::FILES)->insert($rows); }
        }
    }

    public function files($moduleId)
    {
        return Capsule::table(self::FILES)->where('module_id', (string) $moduleId)->orderBy('relative_path')->get();
    }

    /* ------------------------------------------------------------ settings */

    /**
     * Stored non-secret settings for a module.
     *
     * Returns an empty set rather than failing when the settings table has not
     * been created yet, so an older deployment keeps working until it upgrades.
     *
     * @return array setting_key => string value
     */
    public function settings($moduleId)
    {
        try {
            if (!Capsule::schema()->hasTable(self::SETTINGS)) { return array(); }
        } catch (\Throwable $unavailable) {
            return array();
        }
        $values = array();
        foreach (Capsule::table(self::SETTINGS)->where('module_id', (string) $moduleId)->get() as $row) {
            $values[(string) $row->setting_key] = (string) $row->setting_value;
        }
        return $values;
    }

    /**
     * Persist validated settings. Values arrive already checked against the
     * module manifest, and credential-shaped keys can never reach this table.
     */
    public function saveSettings($moduleId, array $values, $adminId)
    {
        if (!Capsule::schema()->hasTable(self::SETTINGS)) {
            throw new ModuleException(
                'The module settings table is missing. Deactivate and reactivate the Module Manager to run its migrations.',
                ModuleException::REASON_STATE
            );
        }
        $now = date('Y-m-d H:i:s');
        foreach ($values as $key => $value) {
            Capsule::table(self::SETTINGS)->updateOrInsert(
                array('module_id' => (string) $moduleId, 'setting_key' => (string) $key),
                array('setting_value' => (string) $value, 'updated_by' => $adminId, 'updated_at' => $now)
            );
        }
        return count($values);
    }

    /* -------------------------------------------------------------- events */

    public function recordEvent(array $event)
    {
        $correlation = isset($event['correlation_id']) && $event['correlation_id'] !== ''
            ? (string) $event['correlation_id']
            : Logger::correlationId();
        Capsule::table(self::EVENTS)->insert(array(
            'module_id' => substr(isset($event['module_id']) ? (string) $event['module_id'] : '', 0, 64),
            'event_type' => substr(isset($event['event_type']) ? (string) $event['event_type'] : 'install', 0, 32),
            'result' => in_array(isset($event['result']) ? $event['result'] : '', array('success', 'failed', 'denied'), true) ? $event['result'] : 'failed',
            'version_from' => substr(isset($event['version_from']) ? (string) $event['version_from'] : '', 0, 32),
            'version_to' => substr(isset($event['version_to']) ? (string) $event['version_to'] : '', 0, 32),
            'package_checksum' => substr(isset($event['package_checksum']) ? (string) $event['package_checksum'] : '', 0, 64),
            'detail' => substr(isset($event['detail']) ? (string) $event['detail'] : '', 0, 500),
            'correlation_id' => $correlation,
            'admin_id' => isset($event['admin_id']) && $event['admin_id'] ? (int) $event['admin_id'] : null,
            'admin_ip' => substr(isset($event['admin_ip']) ? (string) $event['admin_ip'] : '', 0, 45),
            'created_at' => date('Y-m-d H:i:s'),
        ));
        return $correlation;
    }

    public function events(array $filters = array(), $page = 1, $perPage = 25)
    {
        $page = max(1, (int) $page);
        $perPage = min(100, max(5, (int) $perPage));
        $query = Capsule::table(self::EVENTS);
        if (!empty($filters['module_id'])) { $query->where('module_id', (string) $filters['module_id']); }
        if (!empty($filters['event_type']) && isset(self::EVENT_TYPES[$filters['event_type']])) {
            $query->where('event_type', (string) $filters['event_type']);
        }
        if (!empty($filters['result']) && in_array($filters['result'], array('success', 'failed', 'denied'), true)) {
            $query->where('result', (string) $filters['result']);
        }
        $total = (int) $query->count();
        $rows = $query->orderBy('id', 'desc')->forPage($page, $perPage)->get();
        return array(
            'rows' => $rows,
            'page' => $page,
            'pages' => max(1, (int) ceil($total / $perPage)),
            'total' => $total,
        );
    }
}
