<?php
/** CloudHost247 Digital Products license management. */
namespace DigitalProducts;

use DigitalProducts\Support\Audit;
use WHMCS\Database\Capsule;

if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

class License
{
    public function generateLicense($data)
    {
        $productId = (int) ($data['product_id'] ?? 0);
        $serviceId = (int) ($data['service_id'] ?? 0);
        $clientId = (int) ($data['client_id'] ?? 0);
        $entitlementId = (int) ($data['entitlement_id'] ?? 0);
        $domain = $this->normalizeDomain($data['domain'] ?? '');
        if (!$productId || !$serviceId || !$clientId) { throw new \RuntimeException('Missing license binding information.'); }

        $existing = Capsule::table('mod_digitalproducts_licenses')
            ->where('service_id', $serviceId)
            ->where('product_id', $productId)
            ->first();
        if ($existing) {
            if ($entitlementId && empty($existing->entitlement_id)) {
                Capsule::table('mod_digitalproducts_licenses')->where('id', $existing->id)->update(array('entitlement_id' => $entitlementId, 'updated_at' => date('Y-m-d H:i:s')));
            }
            return $this->displayKey($existing);
        }

        $licenseKey = $this->generateKey();
        $licenseHash = $this->hashKey($licenseKey);
        $prefix = substr($licenseKey, 0, 16);
        $ciphertext = $this->encryptKey($licenseKey);
        $legacyValue = $ciphertext ? ($prefix . '-ENCRYPTED-' . substr($licenseHash, 0, 8)) : $licenseKey;
        $now = date('Y-m-d H:i:s');
        $id = Capsule::table('mod_digitalproducts_licenses')->insertGetId(array(
            'product_id' => $productId,
            'entitlement_id' => $entitlementId ?: null,
            'service_id' => $serviceId,
            'client_id' => $clientId,
            'license_key' => $legacyValue,
            'license_hash' => $licenseHash,
            'license_prefix' => $prefix,
            'license_ciphertext' => $ciphertext,
            'status' => 'active',
            'domains' => $domain ? json_encode(array($domain)) : null,
            'domain_limit' => 0,
            'activations_limit' => 0,
            'activations_count' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ));
        Audit::record('license.created', 'license', $id, array(), array('product_id' => $productId, 'service_id' => $serviceId, 'client_id' => $clientId, 'license_prefix' => $prefix));
        return $licenseKey;
    }

    public function validateLicense($licenseKey, $domain = null, $product = null)
    {
        $licenseKey = trim((string) $licenseKey);
        if ($licenseKey === '' || strlen($licenseKey) > 128) { return array('valid' => false, 'error' => 'invalid'); }
        $license = $this->findByKey($licenseKey);
        if (!$license) { return array('valid' => false, 'error' => 'invalid'); }
        if ($product !== null && $product !== '') {
            $productRow = Capsule::table('mod_digitalproducts_products')->where('id', (int) $license->product_id)->first();
            $needle = strtolower((string) $product);
            if (!$productRow || !in_array($needle, array(strtolower((string) $productRow->id), strtolower((string) $productRow->slug), strtolower((string) $productRow->product_name), strtolower((string) $productRow->name)), true)) {
                return array('valid' => false, 'error' => 'invalid');
            }
        }
        if ((string) $license->status !== 'active') { return array('valid' => false, 'error' => 'inactive'); }
        if (!$this->bindingIsActive($license)) { return array('valid' => false, 'error' => 'inactive'); }
        if ($license->expires_at && strtotime($license->expires_at) < time()) {
            Capsule::table('mod_digitalproducts_licenses')->where('id', $license->id)->update(array('status' => 'expired', 'updated_at' => date('Y-m-d H:i:s')));
            return array('valid' => false, 'error' => 'inactive');
        }
        $domain = $this->normalizeDomain($domain);
        if ($domain) {
            $domains = $this->domains($license);
            if ($domains && !in_array($domain, $domains, true)) { return array('valid' => false, 'error' => 'invalid'); }
        }
        return array('valid' => true, 'license' => $license);
    }

    public function activateLicense($licenseKey, $domain)
    {
        $licenseKey = trim((string) $licenseKey);
        $domain = $this->normalizeDomain($domain);
        if ($licenseKey === '' || $domain === '') { return array('success' => false, 'error' => 'invalid'); }
        $license = $this->findByKey($licenseKey);
        if (!$license || (string) $license->status !== 'active' || !$this->bindingIsActive($license)) { return array('success' => false, 'error' => 'invalid'); }
        if ($license->expires_at && strtotime($license->expires_at) < time()) { return array('success' => false, 'error' => 'invalid'); }

        $domains = $this->domains($license);
        if (in_array($domain, $domains, true)) { return array('success' => true, 'status' => 'already_active'); }
        $limit = (int) ($license->domain_limit ?: $license->activations_limit);
        if ($limit > 0 && count($domains) >= $limit) { return array('success' => false, 'error' => 'limit'); }
        $domains[] = $domain;
        Capsule::table('mod_digitalproducts_licenses')->where('id', $license->id)->update(array(
            'domains' => json_encode(array_values($domains)),
            'activations_count' => count($domains),
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        Audit::record('license.activated', 'license', $license->id, array('domains' => $license->domains), array('domain' => $domain));
        return array('success' => true, 'status' => 'active');
    }

    public function displayKey($license)
    {
        if (!$license) { return null; }
        if (!empty($license->license_ciphertext)) {
            $plain = $this->decryptKey($license->license_ciphertext);
            if ($plain) { return $plain; }
        }
        if (!empty($license->license_key) && strpos((string) $license->license_key, '-ENCRYPTED-') === false) { return $license->license_key; }
        return !empty($license->license_prefix) ? ($license->license_prefix . '-••••') : null;
    }

    public function getLicenseByService($serviceId)
    {
        return Capsule::table('mod_digitalproducts_licenses')->where('service_id', (int) $serviceId)->first();
    }

    public function getClientLicenses($clientId)
    {
        $rows = Capsule::table('mod_digitalproducts_licenses')
            ->select('mod_digitalproducts_licenses.*', 'mod_digitalproducts_products.product_name', 'mod_digitalproducts_products.slug')
            ->leftJoin('mod_digitalproducts_products', 'mod_digitalproducts_products.id', '=', 'mod_digitalproducts_licenses.product_id')
            ->where('mod_digitalproducts_licenses.client_id', (int) $clientId)
            ->get();
        foreach ($rows as $row) { $row->license_key_display = $this->displayKey($row); unset($row->license_ciphertext); unset($row->license_hash); }
        return $rows;
    }

    public function updateLicenseStatus($licenseId, $status)
    {
        if (!in_array($status, array('active', 'suspended', 'expired', 'cancelled'), true)) { throw new \RuntimeException('Invalid license status.'); }
        $before = Capsule::table('mod_digitalproducts_licenses')->where('id', (int) $licenseId)->first();
        if (!$before) { throw new \RuntimeException('License not found.'); }
        Capsule::table('mod_digitalproducts_licenses')->where('id', (int) $licenseId)->update(array('status' => $status, 'updated_at' => date('Y-m-d H:i:s')));
        Audit::record('license.' . $status, 'license', $licenseId, (array) $before, array('status' => $status));
        return true;
    }

    private function findByKey($licenseKey)
    {
        $hash = $this->hashKey($licenseKey);
        $license = Capsule::table('mod_digitalproducts_licenses as l')
            ->leftJoin('mod_digitalproducts_products as p', 'p.id', '=', 'l.product_id')
            ->where('l.license_hash', $hash)
            ->select('l.*', 'p.product_name', 'p.slug')
            ->first();
        if ($license) { return $license; }
        // Backward compatibility for legacy plaintext records.
        return Capsule::table('mod_digitalproducts_licenses as l')
            ->leftJoin('mod_digitalproducts_products as p', 'p.id', '=', 'l.product_id')
            ->where('l.license_key', $licenseKey)
            ->select('l.*', 'p.product_name', 'p.slug')
            ->first();
    }

    private function bindingIsActive($license)
    {
        try {
            $product = Capsule::table('mod_digitalproducts_products')->where('id', (int) $license->product_id)->first();
            if ($product && (string) $product->status !== 'active') { return false; }
            if (!empty($license->entitlement_id)) {
                $entitlement = Capsule::table('mod_digitalproducts_entitlements')->where('id', (int) $license->entitlement_id)->first();
                if (!$entitlement || (string) $entitlement->status !== 'active') { return false; }
            }
            if (!empty($license->service_id)) {
                $service = Capsule::table('tblhosting')->where('id', (int) $license->service_id)->first();
                if (!$service || (string) $service->domainstatus !== 'Active') { return false; }
            }
        } catch (\Throwable $ignored) {}
        return true;
    }

    private function generateKey()
    {
        do {
            $parts = array();
            for ($i = 0; $i < 4; $i++) { $parts[] = $this->randomSegment(); }
            $licenseKey = 'CH247-' . implode('-', $parts);
            $exists = Capsule::table('mod_digitalproducts_licenses')
                ->where('license_hash', $this->hashKey($licenseKey))
                ->orWhere('license_key', $licenseKey)
                ->exists();
        } while ($exists);
        return $licenseKey;
    }

    private function randomSegment()
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $segment = '';
        for ($i = 0; $i < 4; $i++) { $segment .= $alphabet[random_int(0, strlen($alphabet) - 1)]; }
        return $segment;
    }

    private function hashKey($licenseKey)
    {
        return hash('sha256', strtoupper(trim((string) $licenseKey)));
    }

    private function encryptKey($licenseKey)
    {
        if (function_exists('encrypt')) {
            try { return encrypt($licenseKey); } catch (\Throwable $ignored) {}
        }
        return null;
    }

    private function decryptKey($ciphertext)
    {
        if (function_exists('decrypt')) {
            try { return decrypt($ciphertext); } catch (\Throwable $ignored) {}
        }
        return null;
    }

    private function normalizeDomain($domain)
    {
        $domain = strtolower(trim((string) $domain));
        $domain = preg_replace('#^https?://#', '', $domain);
        $domain = preg_replace('#/.*$#', '', $domain);
        $domain = preg_replace('/:\d+$/', '', $domain);
        if ($domain === '' || strlen($domain) > 253 || !preg_match('/^[a-z0-9.-]+$/', $domain)) { return ''; }
        return $domain;
    }

    private function domains($license)
    {
        $domains = json_decode((string) $license->domains, true);
        if (!is_array($domains)) { return array(); }
        $out = array();
        foreach ($domains as $domain) {
            $normalized = $this->normalizeDomain($domain);
            if ($normalized !== '') { $out[] = $normalized; }
        }
        return array_values(array_unique($out));
    }
}
