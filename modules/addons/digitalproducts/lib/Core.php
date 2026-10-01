<?php
/** CloudHost247 Digital Products Marketplace core services facade. */
namespace DigitalProducts;

use DigitalProducts\Security\DownloadAuthorizer;
use DigitalProducts\Security\UploadValidator;
use DigitalProducts\Services\EntitlementService;
use DigitalProducts\Services\EmailService;
use DigitalProducts\Storage\LocalPrivateStorage;
use DigitalProducts\Support\Audit;
use WHMCS\Database\Capsule;

if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

class Core
{
    protected $settings = null;

    public function getSettings()
    {
        if ($this->settings !== null) { return $this->settings; }
        $defaults = array(
            'download_limit' => '5',
            'link_expiry_hours' => '48',
            'download_expiry_hours' => '48',
            'license_enabled' => 'on',
            'storage_path' => '',
            'storage_provider' => 'local',
            'email_delivery' => 'on',
            'update_notifications' => '',
            'max_upload_size' => (string) UploadValidator::DEFAULT_MAX_BYTES,
            'allowed_extensions' => 'zip,tar.gz,pdf,js,css,php,json,xml,txt,md,html,htm',
            'default_access_mode' => 'CURRENT_VERSION',
            'single_use_tokens' => 'on',
            'api_rate_limit' => '60',
        );
        $this->settings = $defaults;
        try {
            foreach (Capsule::table('tbladdonmodules')->where('module', 'digitalproducts')->get() as $row) {
                $this->settings[$row->setting] = $row->value;
            }
        } catch (\Throwable $ignored) {}
        return $this->settings;
    }

    public function getStoragePath()
    {
        return (new LocalPrivateStorage($this->getSettings()))->root();
    }

    public function storage()
    {
        return new LocalPrivateStorage($this->getSettings());
    }

    public function getProductByWhmcsId($productId)
    {
        return Capsule::table('mod_digitalproducts_products')
            ->where(function ($q) use ($productId) { $q->where('whmcs_product_id', (int) $productId)->orWhere('product_id', (int) $productId); })
            ->first();
    }

    public function getProduct($dpProductId)
    {
        return Capsule::table('mod_digitalproducts_products')->where('id', (int) $dpProductId)->first();
    }

    public function getAllProducts($status = 'active')
    {
        $query = Capsule::table('mod_digitalproducts_products')
            ->select('mod_digitalproducts_products.*', 'tblproducts.name as whmcs_product_name', 'tblproducts.paytype', 'tblproducts.type')
            ->leftJoin('tblproducts', 'tblproducts.id', '=', 'mod_digitalproducts_products.whmcs_product_id');
        if ($status) { $query->where('mod_digitalproducts_products.status', $status); }
        return $query->orderBy('mod_digitalproducts_products.product_name')->get();
    }

    public function getFileById($fileId)
    {
        return Capsule::table('mod_digitalproducts_files')->where('id', (int) $fileId)->first();
    }

    public function getLatestFile($productId)
    {
        return Capsule::table('mod_digitalproducts_files')
            ->where('product_id', (int) $productId)
            ->where('status', 'active')
            ->orderBy('release_date', 'desc')
            ->orderBy('created_at', 'desc')
            ->first();
    }

    public function getProductFiles($productId, $status = null)
    {
        $query = Capsule::table('mod_digitalproducts_files')->where('product_id', (int) $productId);
        if ($status) { $query->where('status', $status); }
        return $query->orderBy('created_at', 'desc')->get();
    }

    public function getClientDownloads($clientId)
    {
        return (new EntitlementService())->listClientDownloads((int) $clientId);
    }

    public function getDownloadCount($clientId, $serviceId, $fileId)
    {
        $entitlement = Capsule::table('mod_digitalproducts_entitlements')
            ->where('client_id', (int) $clientId)
            ->where('service_id', (int) $serviceId)
            ->first();
        if ($entitlement) { return (int) $entitlement->download_count; }
        return Capsule::table('mod_digitalproducts_downloads')
            ->where('client_id', (int) $clientId)
            ->where('service_id', (int) $serviceId)
            ->where('file_id', (int) $fileId)
            ->where('status', 'success')
            ->count();
    }

    public function logDownload($data)
    {
        $token = isset($data['download_token']) ? (string) $data['download_token'] : '';
        $tokenLog = $token !== '' ? hash('sha256', $token) : null;
        return Capsule::table('mod_digitalproducts_downloads')->insertGetId(array(
            'file_id' => (int) ($data['file_id'] ?? 0),
            'version_id' => (int) ($data['version_id'] ?? ($data['file_id'] ?? 0)),
            'product_id' => (int) ($data['product_id'] ?? 0),
            'service_id' => (int) ($data['service_id'] ?? 0),
            'order_id' => (int) ($data['order_id'] ?? 0),
            'client_id' => (int) ($data['client_id'] ?? 0),
            'token_id' => isset($data['token_id']) ? (int) $data['token_id'] : null,
            'license_id' => isset($data['license_id']) ? (int) $data['license_id'] : null,
            'license_key' => isset($data['license_key']) && $data['license_key'] !== '' ? substr(hash('sha256', (string) $data['license_key']), 0, 32) : null,
            'download_token' => $tokenLog,
            'ip_address' => isset($_SERVER['REMOTE_ADDR']) ? substr((string) $_SERVER['REMOTE_ADDR'], 0, 45) : '',
            'user_agent' => isset($_SERVER['HTTP_USER_AGENT']) ? substr((string) $_SERVER['HTTP_USER_AGENT'], 0, 1000) : '',
            'status' => (string) ($data['status'] ?? 'success'),
            'failure_reason' => isset($data['failure_reason']) ? substr(strip_tags((string) $data['failure_reason']), 0, 255) : null,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function validateServiceOwnership($serviceId, $clientId)
    {
        $service = Capsule::table('tblhosting')
            ->where('id', (int) $serviceId)
            ->where('userid', (int) $clientId)
            ->where('domainstatus', 'Active')
            ->first();
        if (!$service) { return false; }
        return (bool) $this->getProductByWhmcsId((int) $service->packageid);
    }

    public function generateToken($serviceId, $fileId, $clientId)
    {
        $singleUse = $this->getSettings()['single_use_tokens'] === 'on';
        $token = (new DownloadAuthorizer())->generateTokenForClient((int) $clientId, (int) $serviceId, (int) $fileId, $singleUse);
        return $token['token'];
    }

    public function generateDownloadTokenRecord($serviceId, $fileId, $clientId)
    {
        $singleUse = $this->getSettings()['single_use_tokens'] === 'on';
        return (new DownloadAuthorizer())->generateTokenForClient((int) $clientId, (int) $serviceId, (int) $fileId, $singleUse);
    }

    public function validateToken($token)
    {
        $record = (new \DigitalProducts\Security\TokenService())->find($token);
        if (!$record) { return false; }
        if ($record->expires_at && strtotime($record->expires_at) <= time()) { return false; }
        return array('service_id' => (int) $record->service_id, 'file_id' => (int) $record->file_id, 'client_id' => (int) $record->client_id, 'expires_at' => $record->expires_at, 'token_id' => (int) $record->id);
    }

    public function incrementFileDownloadCount($fileId)
    {
        Capsule::table('mod_digitalproducts_files')->where('id', (int) $fileId)->increment('download_count');
    }

    public function getDashboardStats()
    {
        $today = date('Y-m-d');
        $month = date('Y-m-01');
        return array(
            'products' => Capsule::table('mod_digitalproducts_products')->count(),
            'active_products' => Capsule::table('mod_digitalproducts_products')->where('status', 'active')->count(),
            'files' => Capsule::table('mod_digitalproducts_files')->count(),
            'versions' => Capsule::table('mod_digitalproducts_files')->count(),
            'entitlements' => Capsule::table('mod_digitalproducts_entitlements')->count(),
            'active_licenses' => Capsule::table('mod_digitalproducts_licenses')->where('status', 'active')->count(),
            'downloads' => Capsule::table('mod_digitalproducts_downloads')->where('status', 'success')->count(),
            'today_downloads' => Capsule::table('mod_digitalproducts_downloads')->where('status', 'success')->whereDate('created_at', $today)->count(),
            'month_downloads' => Capsule::table('mod_digitalproducts_downloads')->where('status', 'success')->where('created_at', '>=', $month . ' 00:00:00')->count(),
            'failed_downloads' => Capsule::table('mod_digitalproducts_downloads')->where('status', '<>', 'success')->count(),
            'expired_tokens' => Capsule::table('mod_digitalproducts_download_tokens')->whereNotNull('expires_at')->where('expires_at', '<=', date('Y-m-d H:i:s'))->count(),
        );
    }

    public function getDownloadLogs($page = 1, $perPage = 25, $filters = array())
    {
        $page = max(1, (int) $page); $perPage = max(10, min(100, (int) $perPage));
        $query = Capsule::table('mod_digitalproducts_downloads')
            ->select('mod_digitalproducts_downloads.*', 'mod_digitalproducts_products.product_name', 'mod_digitalproducts_files.version', 'mod_digitalproducts_files.original_name', 'tblclients.firstname', 'tblclients.lastname', 'tblclients.email')
            ->leftJoin('mod_digitalproducts_products', 'mod_digitalproducts_products.id', '=', 'mod_digitalproducts_downloads.product_id')
            ->leftJoin('mod_digitalproducts_files', 'mod_digitalproducts_files.id', '=', 'mod_digitalproducts_downloads.file_id')
            ->leftJoin('tblclients', 'tblclients.id', '=', 'mod_digitalproducts_downloads.client_id');
        if (!empty($filters['client_id'])) { $query->where('mod_digitalproducts_downloads.client_id', (int) $filters['client_id']); }
        if (!empty($filters['product_id'])) { $query->where('mod_digitalproducts_downloads.product_id', (int) $filters['product_id']); }
        if (!empty($filters['status'])) { $query->where('mod_digitalproducts_downloads.status', preg_replace('/[^a-z_]/', '', (string) $filters['status'])); }
        if (!empty($filters['date_from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $filters['date_from'])) { $query->whereDate('mod_digitalproducts_downloads.created_at', '>=', $filters['date_from']); }
        if (!empty($filters['date_to']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $filters['date_to'])) { $query->whereDate('mod_digitalproducts_downloads.created_at', '<=', $filters['date_to']); }
        $total = (clone $query)->count();
        $results = $query->orderBy('mod_digitalproducts_downloads.created_at', 'desc')->offset(($page - 1) * $perPage)->limit($perPage)->get();
        return array('data' => $results, 'total' => $total, 'page' => $page, 'per_page' => $perPage, 'last_page' => max(1, (int) ceil($total / $perPage)));
    }

    public function getUnlinkedWhmcsProducts()
    {
        $linked = Capsule::table('mod_digitalproducts_products')->pluck('whmcs_product_id')->toArray();
        $legacy = Capsule::table('mod_digitalproducts_products')->pluck('product_id')->toArray();
        $linkedIds = array_values(array_unique(array_filter(array_merge($linked, $legacy))));
        $query = Capsule::table('tblproducts')->where('hidden', 0)->select('id', 'name', 'type');
        if ($linkedIds) { $query->whereNotIn('id', $linkedIds); }
        return $query->orderBy('name')->get();
    }

    public function createDigitalProduct($whmcsProductId, $data = array())
    {
        $whmcsProductId = (int) $whmcsProductId;
        if (!$whmcsProductId) { throw new \RuntimeException('WHMCS product is required.'); }
        if ($this->getProductByWhmcsId($whmcsProductId)) { throw new \RuntimeException('This WHMCS product is already linked.'); }
        $whmcsProduct = Capsule::table('tblproducts')->where('id', $whmcsProductId)->first();
        if (!$whmcsProduct) { throw new \RuntimeException('WHMCS product not found.'); }
        $settings = $this->getSettings();
        $name = trim((string) ($data['product_name'] ?? $whmcsProduct->name));
        $slug = $this->uniqueSlug($data['slug'] ?? $name);
        $now = date('Y-m-d H:i:s');
        $id = Capsule::table('mod_digitalproducts_products')->insertGetId(array(
            'product_id' => $whmcsProductId,
            'whmcs_product_id' => $whmcsProductId,
            'product_name' => $name,
            'name' => $name,
            'slug' => $slug,
            'description' => (string) ($data['description'] ?? ''),
            'short_description' => (string) ($data['short_description'] ?? ''),
            'product_type' => $this->validProductType($data['product_type'] ?? 'software'),
            'status' => $this->validProductStatus($data['status'] ?? 'draft'),
            'download_limit' => max(0, (int) ($data['download_limit'] ?? $settings['download_limit'])),
            'link_expiry_hours' => max(0, (int) ($data['download_expiry_hours'] ?? $settings['link_expiry_hours'])),
            'download_expiry_hours' => max(0, (int) ($data['download_expiry_hours'] ?? $settings['download_expiry_hours'])),
            'license_enabled' => isset($data['license_enabled']) ? (bool) $data['license_enabled'] : ($settings['license_enabled'] === 'on'),
            'license_expiry_mode' => (string) ($data['license_expiry_mode'] ?? 'none'),
            'access_mode' => $this->validAccessMode($data['access_mode'] ?? $settings['default_access_mode']),
            'created_at' => $now,
            'updated_at' => $now,
        ));
        Audit::record('product.created', 'product', $id, array(), array('whmcs_product_id' => $whmcsProductId, 'name' => $name));
        return $id;
    }

    public function updateDigitalProduct($dpProductId, $data)
    {
        $before = $this->getProduct($dpProductId);
        if (!$before) { throw new \RuntimeException('Product not found.'); }
        $update = array();
        if (isset($data['product_name'])) { $update['product_name'] = trim((string) $data['product_name']); $update['name'] = $update['product_name']; }
        if (isset($data['slug'])) { $update['slug'] = $this->uniqueSlug($data['slug'], (int) $dpProductId); }
        foreach (array('description', 'short_description', 'license_expiry_mode') as $field) { if (isset($data[$field])) { $update[$field] = (string) $data[$field]; } }
        if (isset($data['product_type'])) { $update['product_type'] = $this->validProductType($data['product_type']); }
        if (isset($data['status'])) { $update['status'] = $this->validProductStatus($data['status']); }
        if (array_key_exists('current_file_id', $data)) { $update['current_file_id'] = $data['current_file_id'] ? (int) $data['current_file_id'] : null; $update['current_version_id'] = $update['current_file_id']; }
        if (isset($data['download_limit'])) { $update['download_limit'] = max(0, (int) $data['download_limit']); }
        if (isset($data['download_expiry_hours'])) { $update['download_expiry_hours'] = max(0, (int) $data['download_expiry_hours']); $update['link_expiry_hours'] = $update['download_expiry_hours']; }
        if (isset($data['link_expiry_hours'])) { $update['link_expiry_hours'] = max(0, (int) $data['link_expiry_hours']); $update['download_expiry_hours'] = $update['link_expiry_hours']; }
        if (isset($data['license_enabled'])) { $update['license_enabled'] = (bool) $data['license_enabled']; }
        if (isset($data['access_mode'])) { $update['access_mode'] = $this->validAccessMode($data['access_mode']); }
        if (!$update) { return false; }
        $update['updated_at'] = date('Y-m-d H:i:s');
        Capsule::table('mod_digitalproducts_products')->where('id', (int) $dpProductId)->update($update);
        Audit::record('product.updated', 'product', $dpProductId, (array) $before, $update);
        return true;
    }

    public function uploadVersion($productId, array $file, array $data)
    {
        $product = $this->getProduct($productId);
        if (!$product) { throw new \RuntimeException('Product not found.'); }
        $version = trim((string) ($data['version'] ?? ''));
        if ($version === '' || !preg_match('/^[A-Za-z0-9._+-]{1,50}$/', $version)) { throw new \RuntimeException('Version must contain only letters, numbers, dots, underscores, pluses and hyphens.'); }
        if (Capsule::table('mod_digitalproducts_files')->where('product_id', (int) $productId)->where('version', $version)->where('status', '<>', 'retired')->exists()) {
            throw new \RuntimeException('This product already has that version. Retire the old version first or use a new version number.');
        }
        $settings = $this->getSettings();
        $received = (new UploadValidator($settings))->validate($file);
        $now = date('Y-m-d H:i:s');
        $versionId = Capsule::table('mod_digitalproducts_files')->insertGetId(array(
            'product_id' => (int) $productId,
            'version' => $version,
            'filename' => 'pending',
            'original_name' => $received['original_name'],
            'file_path' => null,
            'storage_provider' => 'local',
            'storage_key' => null,
            'file_hash' => $received['checksum'],
            'checksum_sha256' => $received['checksum'],
            'file_size' => $received['bytes'],
            'release_notes' => (string) ($data['release_notes'] ?? ($data['changelog'] ?? '')),
            'changelog' => (string) ($data['changelog'] ?? ($data['release_notes'] ?? '')),
            'minimum_php_version' => $this->cleanVersion($data['minimum_php_version'] ?? ''),
            'maximum_php_version' => $this->cleanVersion($data['maximum_php_version'] ?? ''),
            'minimum_whmcs_version' => $this->cleanVersion($data['minimum_whmcs_version'] ?? ''),
            'maximum_whmcs_version' => $this->cleanVersion($data['maximum_whmcs_version'] ?? ''),
            'required_extensions' => (string) ($data['required_extensions'] ?? ''),
            'required_modules' => (string) ($data['required_modules'] ?? ''),
            'release_date' => !empty($data['release_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $data['release_date']) ? $data['release_date'] : date('Y-m-d'),
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ));
        try {
            $stored = $this->storage()->storeUploadedFile($received['path'], (int) $productId, (int) $versionId, $received['original_name'], $received['extension']);
            Capsule::table('mod_digitalproducts_files')->where('id', $versionId)->update(array(
                'filename' => $stored['filename'],
                'file_path' => $stored['file_path'],
                'storage_provider' => $stored['storage_provider'],
                'storage_key' => $stored['storage_key'],
                'updated_at' => date('Y-m-d H:i:s'),
            ));
        } catch (\Throwable $e) {
            Capsule::table('mod_digitalproducts_files')->where('id', $versionId)->delete();
            throw $e;
        }
        if (empty($product->current_file_id) || !empty($data['set_current'])) { $this->setCurrentVersion($productId, $versionId); }
        Audit::record('version.uploaded', 'version', $versionId, array(), array('product_id' => $productId, 'version' => $version, 'checksum_sha256' => $received['checksum']));
        if (!empty($data['set_current']) && $this->getSettings()['update_notifications'] === 'on') { $this->notifyUpdate((int) $productId, (int) $versionId); }
        return $versionId;
    }

    public function setCurrentVersion($productId, $fileId)
    {
        $product = $this->getProduct($productId);
        $file = $this->getFileById($fileId);
        if (!$product || !$file || (int) $file->product_id !== (int) $productId || (string) $file->status !== 'active') { throw new \RuntimeException('The selected version is not active for this product.'); }
        Capsule::table('mod_digitalproducts_products')->where('id', (int) $productId)->update(array('current_file_id' => (int) $fileId, 'current_version_id' => (int) $fileId, 'updated_at' => date('Y-m-d H:i:s')));
        Audit::record('version.activated', 'version', $fileId, array('current_file_id' => $product->current_file_id), array('current_file_id' => $fileId));
    }

    public function retireFile($fileId)
    {
        $file = $this->getFileById($fileId);
        if (!$file) { throw new \RuntimeException('File not found.'); }
        Capsule::table('mod_digitalproducts_files')->where('id', (int) $fileId)->update(array('status' => 'retired', 'updated_at' => date('Y-m-d H:i:s')));
        Capsule::table('mod_digitalproducts_products')->where('current_file_id', (int) $fileId)->update(array('current_file_id' => null, 'current_version_id' => null, 'updated_at' => date('Y-m-d H:i:s')));
        Audit::record('version.retired', 'version', $fileId, (array) $file, array('status' => 'retired'));
    }

    public function deleteDigitalProduct($dpProductId)
    {
        $before = $this->getProduct($dpProductId);
        if (!$before) { return false; }
        Capsule::table('mod_digitalproducts_products')->where('id', (int) $dpProductId)->update(array('status' => 'retired', 'updated_at' => date('Y-m-d H:i:s')));
        Capsule::table('mod_digitalproducts_entitlements')->where('product_id', (int) $dpProductId)->update(array('status' => 'revoked', 'updated_at' => date('Y-m-d H:i:s')));
        Audit::record('product.retired', 'product', $dpProductId, (array) $before, array('status' => 'retired'));
        return true;
    }

    public function saveSettings(array $settings)
    {
        $validated = array(
            'download_limit' => (string) max(0, (int) ($settings['download_limit'] ?? 5)),
            'link_expiry_hours' => (string) max(0, (int) ($settings['download_expiry_hours'] ?? ($settings['link_expiry_hours'] ?? 48))),
            'download_expiry_hours' => (string) max(0, (int) ($settings['download_expiry_hours'] ?? ($settings['link_expiry_hours'] ?? 48))),
            'license_enabled' => !empty($settings['license_enabled']) ? 'on' : '',
            'email_delivery' => !empty($settings['email_delivery']) ? 'on' : '',
            'update_notifications' => !empty($settings['update_notifications']) ? 'on' : '',
            'single_use_tokens' => !empty($settings['single_use_tokens']) ? 'on' : '',
            'storage_provider' => 'local',
            'storage_path' => $this->validateStoragePath($settings['storage_path'] ?? ''),
            'max_upload_size' => (string) min(2147483647, max(65536, (int) ($settings['max_upload_size'] ?? UploadValidator::DEFAULT_MAX_BYTES))),
            'allowed_extensions' => implode(',', (new UploadValidator(array('allowed_extensions' => (string) ($settings['allowed_extensions'] ?? ''))))->allowedExtensions()),
            'default_access_mode' => $this->validAccessMode($settings['default_access_mode'] ?? 'CURRENT_VERSION'),
            'api_rate_limit' => (string) max(5, min(1000, (int) ($settings['api_rate_limit'] ?? 60))),
        );
        foreach ($validated as $key => $value) {
            Capsule::table('tbladdonmodules')->updateOrInsert(array('module' => 'digitalproducts', 'setting' => $key), array('value' => $value));
        }
        $this->settings = null;
        Audit::record('settings.changed', 'settings', 'digitalproducts', array(), $validated);
    }

    private function notifyUpdate($productId, $fileId)
    {
        try {
            $product = $this->getProduct($productId); $file = $this->getFileById($fileId);
            foreach (Capsule::table('mod_digitalproducts_entitlements')->where('product_id', $productId)->where('status', 'active')->get() as $entitlement) {
                (new EmailService())->sendUpdateEmail($entitlement, $product, $file);
            }
        } catch (\Throwable $e) { if (function_exists('logActivity')) { logActivity('DigitalProducts update notification failed: ' . $e->getMessage()); } }
    }

    private function validProductType($type)
    {
        $type = strtolower((string) $type);
        $allowed = array('module', 'plugin', 'theme', 'script', 'software', 'template', 'api', 'document', 'media', 'other');
        return in_array($type, $allowed, true) ? $type : 'other';
    }

    private function validProductStatus($status)
    {
        $status = strtolower((string) $status);
        $allowed = array('draft', 'active', 'inactive', 'retired');
        return in_array($status, $allowed, true) ? $status : 'draft';
    }

    private function validAccessMode($mode)
    {
        $mode = strtoupper((string) $mode);
        return in_array($mode, array('CURRENT_VERSION', 'PURCHASE_VERSION'), true) ? $mode : 'CURRENT_VERSION';
    }

    private function uniqueSlug($value, $ignoreId = 0)
    {
        $base = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', (string) $value), '-'));
        if ($base === '') { $base = 'digital-product'; }
        $base = substr($base, 0, 160);
        $slug = $base; $i = 2;
        while (true) {
            $query = Capsule::table('mod_digitalproducts_products')->where('slug', $slug);
            if ($ignoreId) { $query->where('id', '<>', (int) $ignoreId); }
            if (!$query->exists()) { return $slug; }
            $slug = $base . '-' . $i++;
        }
    }

    private function cleanVersion($value)
    {
        $value = trim((string) $value);
        return $value !== '' && preg_match('/^[0-9A-Za-z.+-]{1,32}$/', $value) ? $value : null;
    }

    private function validateStoragePath($path)
    {
        $path = trim((string) $path);
        if ($path === '') { return ''; }
        if (strpos($path, "\0") !== false || preg_match('#(^|/)\.\.(?:/|$)#', str_replace('\\', '/', $path))) { throw new \RuntimeException('Storage path cannot contain traversal.'); }
        if ($path[0] !== '/' && !preg_match('/^[A-Za-z]:[\\\\\/]/', $path)) { throw new \RuntimeException('Storage path must be absolute.'); }
        return rtrim($path, "/\\");
    }
}
