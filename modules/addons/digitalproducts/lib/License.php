<?php
/**
 * DigitalProducts License Class
 *
 * Handles license key generation, validation and management.
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

class License
{
    /**
     * Generate a license key for a purchase
     */
    public function generateLicense($data)
    {
        $productId = (int)($data['product_id'] ?? 0);
        $serviceId = (int)($data['service_id'] ?? 0);
        $clientId = (int)($data['client_id'] ?? 0);
        $domain = $data['domain'] ?? '';

        // Check if license already exists
        $existing = Capsule::table('mod_digitalproducts_licenses')
            ->where('service_id', $serviceId)
            ->where('product_id', $productId)
            ->first();

        if ($existing) {
            return $existing->license_key;
        }

        $licenseKey = $this->generateKey();

        Capsule::table('mod_digitalproducts_licenses')->insert([
            'product_id' => $productId,
            'service_id' => $serviceId,
            'client_id' => $clientId,
            'license_key' => $licenseKey,
            'status' => 'active',
            'domains' => $domain ? json_encode([$domain]) : null,
            'activations_limit' => 0, // 0 = unlimited
            'activations_count' => 0,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ]);

        return $licenseKey;
    }

    /**
     * Validate a license key
     */
    public function validateLicense($licenseKey, $domain = null)
    {
        $license = Capsule::table('mod_digitalproducts_licenses')
            ->where('license_key', $licenseKey)
            ->first();

        if (!$license) {
            return ['valid' => false, 'error' => 'License not found'];
        }

        if ($license->status !== 'active') {
            return ['valid' => false, 'error' => 'License is ' . $license->status];
        }

        if ($license->expires_at && strtotime($license->expires_at) < time()) {
            // Auto-expire
            Capsule::table('mod_digitalproducts_licenses')
                ->where('id', $license->id)
                ->update(['status' => 'expired', 'updated_at' => date('Y-m-d H:i:s')]);
            return ['valid' => false, 'error' => 'License has expired'];
        }

        // Domain check
        if ($domain && $license->domains) {
            $allowedDomains = json_decode($license->domains, true) ?? [];
            if (!empty($allowedDomains) && !in_array($domain, $allowedDomains)) {
                return ['valid' => false, 'error' => 'Domain not authorized'];
            }
        }

        return [
            'valid' => true,
            'license' => $license,
        ];
    }

    /**
     * Activate license on a domain
     */
    public function activateLicense($licenseKey, $domain)
    {
        $license = Capsule::table('mod_digitalproducts_licenses')
            ->where('license_key', $licenseKey)
            ->first();

        if (!$license) {
            return ['success' => false, 'error' => 'License not found'];
        }

        if ($license->status !== 'active') {
            return ['success' => false, 'error' => 'License is ' . $license->status];
        }

        $activationsLimit = (int)$license->activations_limit;
        if ($activationsLimit > 0 && $license->activations_count >= $activationsLimit) {
            return ['success' => false, 'error' => 'Activation limit reached'];
        }

        $domains = json_decode($license->domains ?? '[]', true) ?: [];
        if (!in_array($domain, $domains)) {
            $domains[] = $domain;
        }

        Capsule::table('mod_digitalproducts_licenses')
            ->where('id', $license->id)
            ->update([
                'domains' => json_encode(array_values($domains)),
                'activations_count' => $license->activations_count + 1,
                'updated_at' => date('Y-m-d H:i:s'),
            ]);

        return ['success' => true];
    }

    /**
     * Get license by service ID
     */
    public function getLicenseByService($serviceId)
    {
        return Capsule::table('mod_digitalproducts_licenses')
            ->where('service_id', $serviceId)
            ->first();
    }

    /**
     * Get all client licenses
     */
    public function getClientLicenses($clientId)
    {
        return Capsule::table('mod_digitalproducts_licenses')
            ->select(
                'mod_digitalproducts_licenses.*',
                'mod_digitalproducts_products.product_name'
            )
            ->leftJoin('mod_digitalproducts_products', 'mod_digitalproducts_products.id', '=', 'mod_digitalproducts_licenses.product_id')
            ->where('mod_digitalproducts_licenses.client_id', $clientId)
            ->get();
    }

    /**
     * Update license status
     */
    public function updateLicenseStatus($licenseId, $status)
    {
        $allowedStatuses = ['active', 'suspended', 'expired', 'cancelled'];
        if (!in_array($status, $allowedStatuses)) {
            throw new Exception("Invalid license status.");
        }

        return Capsule::table('mod_digitalproducts_licenses')
            ->where('id', $licenseId)
            ->update([
                'status' => $status,
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
    }

    /**
     * Generate a unique license key
     */
    protected function generateKey()
    {
        $prefix = 'DP';
        $segments = 4;
        $key = [];

        for ($i = 0; $i < $segments; $i++) {
            $key[] = strtoupper(substr(str_shuffle('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'), 0, 4));
        }

        $licenseKey = $prefix . '-' . implode('-', $key);

        // Ensure uniqueness
        $exists = Capsule::table('mod_digitalproducts_licenses')
            ->where('license_key', $licenseKey)
            ->exists();

        if ($exists) {
            return $this->generateKey();
        }

        return $licenseKey;
    }
}
