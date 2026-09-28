<?php
/**
 * Test doubles for the Module Manager suite.
 *
 * The foundation classes (WHMCS session, CSRF, audit trail) and the database
 * registry are replaced with in-memory equivalents so the real upload,
 * inspection, extraction, installation, rollback and uninstall code paths can
 * be executed end to end without WHMCS.
 */

namespace CloudHost247\Foundation\Security {
    class AdminGuard
    {
        public static $adminId = 7;
        public static $denied = array();
        public static $tokenValid = true;
        public static $calls = array();

        public static function reset()
        {
            self::$adminId = 7;
            self::$denied = array();
            self::$tokenValid = true;
            self::$calls = array();
        }

        public static function requireAdmin()
        {
            self::$calls[] = 'requireAdmin';
            if (!self::$adminId) { throw new \RuntimeException('An authenticated WHMCS administrator is required.'); }
            return (int) self::$adminId;
        }

        public static function requirePostToken()
        {
            self::$calls[] = 'requirePostToken';
            if (!self::$tokenValid) { throw new \RuntimeException('Invalid or expired CSRF token.'); }
            return true;
        }

        public static function requireCapability($module, $capability)
        {
            self::$calls[] = 'require:' . $capability;
            if (in_array($capability, self::$denied, true)) {
                throw new \RuntimeException('Your WHMCS administrator role lacks the required CloudHost247 capability.');
            }
            return true;
        }

        public static function capability($module, $capability)
        {
            return !in_array($capability, self::$denied, true);
        }
    }
}

namespace CloudHost247\Foundation\Support {
    class Logger
    {
        public static $lines = array();
        public static function write($module, $level, $event, array $context = array(), $correlationId = '')
        {
            self::$lines[] = array('module' => $module, 'level' => $level, 'event' => $event, 'context' => $context);
        }
        public static function correlationId()
        {
            return substr(bin2hex(random_bytes(16)), 0, 32);
        }
    }

    class AuditLogger
    {
        public static $records = array();
        public static function record($module, $action, $resourceType, $resourceId, $before, $after, $result = 'success', $failureReason = null, $adminId = null)
        {
            $correlation = Logger::correlationId();
            self::$records[] = array(
                'module' => $module, 'action' => $action, 'resource_type' => $resourceType, 'resource_id' => $resourceId,
                'before' => (array) $before, 'after' => (array) $after, 'result' => $result,
                'failure_reason' => $failureReason, 'admin_id' => $adminId, 'correlation_id' => $correlation,
            );
            return $correlation;
        }
    }

    class SafeError
    {
        public static function from(\Throwable $error, $module, $event, $customerMessage = 'The requested operation could not be completed safely.')
        {
            $id = Logger::correlationId();
            return array('message' => $customerMessage, 'correlation_id' => $id, 'display' => $customerMessage . ' Reference: ' . $id);
        }
    }
}

namespace CloudHost247\ModuleManager\Tests {

    use CloudHost247\ModuleManager\Manifest\Manifest;
    use CloudHost247\ModuleManager\Registry\ModuleRegistry;

    /** In-memory ModuleRegistry mirroring the semantics of the database repository. */
    class ArrayRegistry implements ModuleRegistry
    {
        public $modules = array();
        public $packages = array();
        public $fileRows = array();
        public $eventRows = array();
        private $sequence = 0;

        public function all()
        {
            return array_values($this->modules);
        }

        public function find($moduleId)
        {
            return isset($this->modules[$moduleId]) ? $this->modules[$moduleId] : null;
        }

        public function installedIndex()
        {
            $index = array();
            foreach ($this->modules as $id => $row) {
                $manifest = $this->manifestArray($row);
                $index[$id] = array(
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

        public function manifest($moduleId)
        {
            $data = $this->manifestArray($this->find($moduleId));
            if (!$data) { return null; }
            try { return Manifest::fromArray($data); } catch (\Throwable $invalid) { return null; }
        }

        public function recordInstallation(Manifest $manifest, array $facts, $adminId)
        {
            $now = date('Y-m-d H:i:s');
            $existing = $this->find($manifest->id());
            $row = $existing ? $existing : (object) array(
                'id' => ++$this->sequence,
                'module_id' => $manifest->id(),
                'enabled' => 0,
                'installed_by' => $adminId,
                'installed_at' => $now,
                'previous_version' => '',
            );
            if ($existing) { $row->previous_version = (string) $existing->version; }
            $row->name = $manifest->name();
            $row->version = $manifest->version();
            $row->module_type = $manifest->type();
            $row->author = $manifest->author();
            $row->license = $manifest->license();
            $row->description = $manifest->description();
            $row->entry_point = $manifest->entryPoint();
            $row->install_path = $manifest->relativeDirectory();
            $row->status = 'installed';
            $row->manifest_json = $manifest->toJson();
            $row->package_checksum = isset($facts['checksum']) ? (string) $facts['checksum'] : '';
            $row->file_count = isset($facts['file_count']) ? (int) $facts['file_count'] : 0;
            $row->installed_bytes = isset($facts['bytes']) ? (int) $facts['bytes'] : 0;
            $row->updated_by = $adminId;
            $row->updated_at = $now;
            $row->health_status = 'unknown';
            $row->health_detail = '';
            $row->health_checked_at = null;
            $this->modules[$manifest->id()] = $row;
            return (int) $row->id;
        }

        public function setEnabled($moduleId, $enabled, $adminId)
        {
            if (!isset($this->modules[$moduleId])) { return; }
            $this->modules[$moduleId]->enabled = $enabled ? 1 : 0;
            $this->modules[$moduleId]->status = $enabled ? 'installed' : 'disabled';
            $this->modules[$moduleId]->updated_at = date('Y-m-d H:i:s');
        }

        public function markFailed($moduleId, $detail)
        {
            if (!isset($this->modules[$moduleId])) { return; }
            $this->modules[$moduleId]->status = 'failed';
            $this->modules[$moduleId]->enabled = 0;
            $this->modules[$moduleId]->health_status = 'failed';
            $this->modules[$moduleId]->health_detail = $detail;
        }

        public function recordHealth($moduleId, $status, $detail)
        {
            if (!isset($this->modules[$moduleId])) { return; }
            $this->modules[$moduleId]->health_status = $status;
            $this->modules[$moduleId]->health_detail = $detail;
            $this->modules[$moduleId]->health_checked_at = date('Y-m-d H:i:s');
        }

        public function forget($moduleId)
        {
            unset($this->modules[$moduleId], $this->fileRows[$moduleId]);
        }

        public function recordPackage(array $attributes)
        {
            $checksum = (string) $attributes['checksum'];
            $existing = isset($this->packages[$checksum]) ? (array) $this->packages[$checksum] : array(
                'id' => ++$this->sequence, 'module_id' => '', 'module_name' => '', 'version' => '', 'module_type' => '',
                'file_count' => 0, 'inspection_json' => '', 'rejected_reason' => '', 'status' => 'uploaded',
            );
            $attributes['uploaded_at'] = date('Y-m-d H:i:s');
            $this->packages[$checksum] = (object) array_merge($existing, $attributes);
            return (int) $this->packages[$checksum]->id;
        }

        public function packages($limit = 50)
        {
            return array_slice(array_reverse(array_values($this->packages)), 0, max(1, (int) $limit));
        }

        public function package($checksum)
        {
            return isset($this->packages[$checksum]) ? $this->packages[$checksum] : null;
        }

        public function setPackageStatus($checksum, $status, $reason = '')
        {
            if (!isset($this->packages[$checksum])) { return; }
            $this->packages[$checksum]->status = $status;
            $this->packages[$checksum]->rejected_reason = $reason;
        }

        public function forgetPackage($checksum)
        {
            unset($this->packages[$checksum]);
        }

        public function replaceFileManifest($moduleId, array $files)
        {
            $rows = array();
            foreach ($files as $file) {
                $rows[] = (object) array(
                    'module_id' => $moduleId,
                    'relative_path' => (string) $file['path'],
                    'sha256' => isset($file['sha256']) ? (string) $file['sha256'] : '',
                    'bytes' => isset($file['bytes']) ? (int) $file['bytes'] : 0,
                    'action' => isset($file['action']) ? (string) $file['action'] : 'created',
                    'backup_name' => '',
                );
            }
            usort($rows, function ($left, $right) { return strcmp($left->relative_path, $right->relative_path); });
            $this->fileRows[$moduleId] = $rows;
        }

        public function files($moduleId)
        {
            return isset($this->fileRows[$moduleId]) ? $this->fileRows[$moduleId] : array();
        }

        public function recordEvent(array $event)
        {
            $correlation = !empty($event['correlation_id']) ? (string) $event['correlation_id']
                : \CloudHost247\Foundation\Support\Logger::correlationId();
            $this->eventRows[] = (object) array_merge(array(
                'id' => ++$this->sequence, 'module_id' => '', 'event_type' => 'install', 'result' => 'failed',
                'version_from' => '', 'version_to' => '', 'package_checksum' => '', 'detail' => '',
                'admin_id' => null, 'admin_ip' => '', 'created_at' => date('Y-m-d H:i:s'),
            ), $event, array('correlation_id' => $correlation));
            return $correlation;
        }

        public function events(array $filters = array(), $page = 1, $perPage = 25)
        {
            $rows = array_reverse($this->eventRows);
            foreach (array('module_id', 'event_type', 'result') as $field) {
                if (empty($filters[$field])) { continue; }
                $rows = array_values(array_filter($rows, function ($row) use ($field, $filters) {
                    return (string) $row->{$field} === (string) $filters[$field];
                }));
            }
            $total = count($rows);
            $perPage = min(100, max(5, (int) $perPage));
            $page = max(1, (int) $page);
            return array(
                'rows' => array_slice($rows, ($page - 1) * $perPage, $perPage),
                'page' => $page,
                'pages' => max(1, (int) ceil($total / $perPage)),
                'total' => $total,
            );
        }

        /** Test helper: event types recorded so far. */
        public function eventTypes()
        {
            $types = array();
            foreach ($this->eventRows as $row) { $types[] = $row->event_type . ':' . $row->result; }
            return $types;
        }
    }
}

namespace {
    if (!function_exists('generate_token')) {
        function generate_token($type = 'plain')
        {
            return 'test-csrf-token';
        }
    }
}
