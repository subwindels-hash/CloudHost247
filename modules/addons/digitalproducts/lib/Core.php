<?php
/**
 * DigitalProducts Core Class
 *
 * Main core functionality for the module.
 *
 * @package    DigitalProducts
 * @version    1.0.0
 */

namespace DigitalProducts;

use WHMCS\Database\Capsule;
use Exception;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

class Core
{
    /**
     * Module settings cache
     */
    protected $settings = null;

    /**
     * Get module settings
     */
    public function getSettings()
    {
        if ($this->settings === null) {
            $this->settings = [];
            $rows = Capsule::table('tbladdonmodules')
                ->where('module', 'digitalproducts')
                ->get();

            foreach ($rows as $row) {
                $this->settings[$row->setting] = $row->value;
            }
        }

        return $this->settings;
    }

    /**
     * Get storage path for files
     */
    public function getStoragePath()
    {
        $settings = $this->getSettings();
        $customPath = isset($settings['storage_path']) ? trim($settings['storage_path']) : '';

        if (!empty($customPath)) {
            $path = rtrim($customPath, '/');
        } else {
            $path = ROOTDIR . '/storage/digitalproducts';
        }

        // Ensure directory exists
        if (!is_dir($path)) {
            if (!mkdir($path, 0755, true)) {
                throw new Exception("Failed to create storage directory: {$path}");
            }
        }

        // Protect with .htaccess
        $htaccess = $path . '/.htaccess';
        if (!file_exists($htaccess)) {
            file_put_contents($htaccess, "Options -Indexes\ndeny from all\n");
        }

        return $path;
    }

    /**
     * Get a digital product by WHMCS product ID
     */
    public function getProductByWhmcsId($productId)
    {
        return Capsule::table('mod_digitalproducts_products')
            ->where('product_id', $productId)
            ->first();
    }

    /**
     * Get all active digital products
     */
    public function getAllProducts($status = 'active')
    {
        $query = Capsule::table('mod_digitalproducts_products')
            ->select(
                'mod_digitalproducts_products.*',
                'tblproducts.name as whmcs_product_name',
                'tblproducts.paytype'
            )
            ->leftJoin('tblproducts', 'tblproducts.id', '=', 'mod_digitalproducts_products.product_id');

        if ($status) {
            $query->where('mod_digitalproducts_products.status', $status);
        }

        return $query->get();
    }

    /**
     * Get file by ID
     */
    public function getFileById($fileId)
    {
        return Capsule::table('mod_digitalproducts_files')
            ->where('id', $fileId)
            ->first();
    }

    /**
     * Get latest active file for a product
     */
    public function getLatestFile($productId)
    {
        return Capsule::table('mod_digitalproducts_files')
            ->where('product_id', $productId)
            ->where('status', 'active')
            ->orderBy('created_at', 'desc')
            ->first();
    }

    /**
     * Get all files for a product
     */
    public function getProductFiles($productId, $status = null)
    {
        $query = Capsule::table('mod_digitalproducts_files')
            ->where('product_id', $productId);

        if ($status) {
            $query->where('status', $status);
        }

        return $query->orderBy('created_at', 'desc')->get();
    }

    /**
     * Get client services with download access
     */
    public function getClientDownloads($clientId)
    {
        return Capsule::table('tblhosting')
            ->join('mod_digitalproducts_products', 'mod_digitalproducts_products.product_id', '=', 'tblhosting.packageid')
            ->leftJoin('mod_digitalproducts_files', 'mod_digitalproducts_files.id', '=', 'mod_digitalproducts_products.current_file_id')
            ->leftJoin('mod_digitalproducts_licenses', function($join) {
                $join->on('mod_digitalproducts_licenses.service_id', '=', 'tblhosting.id')
                     ->on('mod_digitalproducts_licenses.product_id', '=', 'mod_digitalproducts_products.id');
            })
            ->where('tblhosting.userid', $clientId)
            ->where('tblhosting.domainstatus', 'Active')
            ->where('mod_digitalproducts_products.status', 'active')
            ->whereNotNull('mod_digitalproducts_products.current_file_id')
            ->select(
                'tblhosting.id as service_id',
                'tblhosting.packageid as whmcs_product_id',
                'tblhosting.regdate as purchase_date',
                'tblhosting.nextduedate',
                'mod_digitalproducts_products.id as dp_product_id',
                'mod_digitalproducts_products.product_name',
                'mod_digitalproducts_products.download_limit',
                'mod_digitalproducts_products.link_expiry_hours',
                'mod_digitalproducts_files.id as file_id',
                'mod_digitalproducts_files.filename',
                'mod_digitalproducts_files.original_name',
                'mod_digitalproducts_files.version',
                'mod_digitalproducts_files.file_size',
                'mod_digitalproducts_files.created_at as file_date',
                'mod_digitalproducts_licenses.license_key',
                'mod_digitalproducts_licenses.status as license_status'
            )
            ->get();
    }

    /**
     * Get download count for a client/service/file
     */
    public function getDownloadCount($clientId, $serviceId, $fileId)
    {
        return Capsule::table('mod_digitalproducts_downloads')
            ->where('client_id', $clientId)
            ->where('service_id', $serviceId)
            ->where('file_id', $fileId)
            ->where('status', 'success')
            ->count();
    }

    /**
     * Log download attempt
     */
    public function logDownload($data)
    {
        return Capsule::table('mod_digitalproducts_downloads')->insertGetId([
            'file_id' => $data['file_id'],
            'product_id' => $data['product_id'],
            'service_id' => $data['service_id'],
            'client_id' => $data['client_id'],
            'license_key' => $data['license_key'] ?? null,
            'download_token' => $data['download_token'] ?? null,
            'ip_address' => $_SERVER['REMOTE_ADDR'] ?? '',
            'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
            'status' => $data['status'] ?? 'success',
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ]);
    }

    /**
     * Validate service belongs to client and is active
     */
    public function validateServiceOwnership($serviceId, $clientId)
    {
        $service = Capsule::table('tblhosting')
            ->where('id', $serviceId)
            ->where('userid', $clientId)
            ->where('domainstatus', 'Active')
            ->first();

        return $service !== null;
    }

    /**
     * Generate secure download token
     */
    public function generateToken($serviceId, $fileId, $clientId)
    {
        $token = bin2hex(random_bytes(32));
        $expiresAt = date('Y-m-d H:i:s', strtotime('+48 hours'));

        // Store in session for quick validation, database for persistence
        $_SESSION['dp_download_' . $token] = [
            'service_id' => $serviceId,
            'file_id' => $fileId,
            'client_id' => $clientId,
            'expires_at' => $expiresAt,
        ];

        return $token;
    }

    /**
     * Validate download token
     */
    public function validateToken($token)
    {
        // Check session first
        if (isset($_SESSION['dp_download_' . $token])) {
            $data = $_SESSION['dp_download_' . $token];
            if (strtotime($data['expires_at']) > time()) {
                return $data;
            }
        }

        return false;
    }

    /**
     * Increment file download count
     */
    public function incrementFileDownloadCount($fileId)
    {
        Capsule::table('mod_digitalproducts_files')
            ->where('id', $fileId)
            ->increment('download_count');
    }

    /**
     * Get dashboard statistics
     */
    public function getDashboardStats()
    {
        $products = Capsule::table('mod_digitalproducts_products')->count();
        $files = Capsule::table('mod_digitalproducts_files')->count();
        $downloads = Capsule::table('mod_digitalproducts_downloads')->count();
        $licenses = Capsule::table('mod_digitalproducts_licenses')->count();
        $todayDownloads = Capsule::table('mod_digitalproducts_downloads')
            ->whereDate('created_at', date('Y-m-d'))
            ->count();

        return [
            'products' => $products,
            'files' => $files,
            'downloads' => $downloads,
            'licenses' => $licenses,
            'today_downloads' => $todayDownloads,
        ];
    }

    /**
     * Get download logs with pagination
     */
    public function getDownloadLogs($page = 1, $perPage = 25, $filters = [])
    {
        $query = Capsule::table('mod_digitalproducts_downloads')
            ->select(
                'mod_digitalproducts_downloads.*',
                'mod_digitalproducts_products.product_name',
                'mod_digitalproducts_files.version',
                'mod_digitalproducts_files.original_name',
                'tblclients.firstname',
                'tblclients.lastname',
                'tblclients.email'
            )
            ->leftJoin('mod_digitalproducts_products', 'mod_digitalproducts_products.id', '=', 'mod_digitalproducts_downloads.product_id')
            ->leftJoin('mod_digitalproducts_files', 'mod_digitalproducts_files.id', '=', 'mod_digitalproducts_downloads.file_id')
            ->leftJoin('tblclients', 'tblclients.id', '=', 'mod_digitalproducts_downloads.client_id')
            ->orderBy('mod_digitalproducts_downloads.created_at', 'desc');

        if (!empty($filters['client_id'])) {
            $query->where('mod_digitalproducts_downloads.client_id', $filters['client_id']);
        }
        if (!empty($filters['product_id'])) {
            $query->where('mod_digitalproducts_downloads.product_id', $filters['product_id']);
        }
        if (!empty($filters['status'])) {
            $query->where('mod_digitalproducts_downloads.status', $filters['status']);
        }
        if (!empty($filters['date_from'])) {
            $query->whereDate('mod_digitalproducts_downloads.created_at', '>=', $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $query->whereDate('mod_digitalproducts_downloads.created_at', '<=', $filters['date_to']);
        }

        $total = $query->count();
        $results = $query->forPage($page, $perPage)->get();

        return [
            'data' => $results,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'last_page' => ceil($total / $perPage),
        ];
    }

    /**
     * Get WHMCS products not yet linked
     */
    public function getUnlinkedWhmcsProducts()
    {
        $linkedIds = Capsule::table('mod_digitalproducts_products')
            ->pluck('product_id')
            ->toArray();

        return Capsule::table('tblproducts')
            ->whereNotIn('id', $linkedIds)
            ->where('hidden', 0)
            ->select('id', 'name', 'type')
            ->get();
    }

    /**
     * Create digital product from WHMCS product
     */
    public function createDigitalProduct($whmcsProductId, $data = [])
    {
        $existing = $this->getProductByWhmcsId($whmcsProductId);
        if ($existing) {
            throw new Exception("Product already linked to digital products.");
        }

        $whmcsProduct = Capsule::table('tblproducts')
            ->where('id', $whmcsProductId)
            ->first();

        if (!$whmcsProduct) {
            throw new Exception("WHMCS product not found.");
        }

        $settings = $this->getSettings();
        $downloadLimit = isset($data['download_limit']) ? (int)$data['download_limit'] : ($settings['download_limit'] ?? 5);
        $linkExpiry = isset($data['link_expiry_hours']) ? (int)$data['link_expiry_hours'] : ($settings['link_expiry_hours'] ?? 48);
        $licenseEnabled = isset($data['license_enabled']) ? (bool)$data['license_enabled'] : ($settings['license_enabled'] == 'on');

        $id = Capsule::table('mod_digitalproducts_products')->insertGetId([
            'product_id' => $whmcsProductId,
            'product_name' => $data['product_name'] ?? $whmcsProduct->name,
            'description' => $data['description'] ?? '',
            'status' => 'active',
            'download_limit' => $downloadLimit,
            'link_expiry_hours' => $linkExpiry,
            'license_enabled' => $licenseEnabled,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ]);

        return $id;
    }

    /**
     * Update digital product
     */
    public function updateDigitalProduct($dpProductId, $data)
    {
        $update = [];
        $allowed = ['product_name', 'description', 'status', 'current_file_id', 'download_limit', 'link_expiry_hours', 'license_enabled'];

        foreach ($allowed as $field) {
            if (isset($data[$field])) {
                $update[$field] = $data[$field];
            }
        }

        if (empty($update)) {
            return false;
        }

        $update['updated_at'] = date('Y-m-d H:i:s');

        return Capsule::table('mod_digitalproducts_products')
            ->where('id', $dpProductId)
            ->update($update);
    }

    /**
     * Delete digital product and related data
     */
    public function deleteDigitalProduct($dpProductId)
    {
        // Get files to delete from disk
        $files = Capsule::table('mod_digitalproducts_files')
            ->where('product_id', $dpProductId)
            ->get();

        foreach ($files as $file) {
            if (file_exists($file->file_path)) {
                unlink($file->file_path);
            }
        }

        Capsule::table('mod_digitalproducts_downloads')
            ->where('product_id', $dpProductId)
            ->delete();

        Capsule::table('mod_digitalproducts_licenses')
            ->where('product_id', $dpProductId)
            ->delete();

        Capsule::table('mod_digitalproducts_files')
            ->where('product_id', $dpProductId)
            ->delete();

        Capsule::table('mod_digitalproducts_products')
            ->where('id', $dpProductId)
            ->delete();

        return true;
    }
}
