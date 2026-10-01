<?php
namespace DigitalProducts\Services;

use DigitalProducts\Support\Audit;
use WHMCS\Database\Capsule;

final class EntitlementService
{
    const STATUS_ACTIVE = 'active';
    const STATUS_SUSPENDED = 'suspended';
    const STATUS_REVOKED = 'revoked';
    const STATUS_EXPIRED = 'expired';

    public function grantForService($serviceId, $orderId = null, $sendAudit = true)
    {
        $serviceId = (int) $serviceId;
        $service = Capsule::table('tblhosting')->where('id', $serviceId)->first();
        if (!$service) { return null; }

        $product = $this->digitalProductForWhmcsProduct((int) $service->packageid);
        if (!$product || (string) $product->status !== 'active') { return null; }

        $versionId = $this->versionForEntitlement($product, null);
        if (!$versionId) { return null; }

        $now = date('Y-m-d H:i:s');
        $orderId = $orderId !== null ? (int) $orderId : (int) (isset($service->orderid) ? $service->orderid : 0);
        $status = $this->serviceAllowsAccess($service, $orderId) ? self::STATUS_ACTIVE : self::STATUS_SUSPENDED;
        $accessMode = in_array((string) $product->access_mode, array('CURRENT_VERSION', 'PURCHASE_VERSION'), true) ? (string) $product->access_mode : 'CURRENT_VERSION';

        $existing = Capsule::table('mod_digitalproducts_entitlements')
            ->where('client_id', (int) $service->userid)
            ->where('service_id', $serviceId)
            ->where('product_id', (int) $product->id)
            ->first();

        $data = array(
            'product_id' => (int) $product->id,
            'whmcs_product_id' => (int) $service->packageid,
            'order_id' => $orderId,
            'service_id' => $serviceId,
            'client_id' => (int) $service->userid,
            'purchase_version_id' => $existing && $existing->purchase_version_id ? (int) $existing->purchase_version_id : (int) $versionId,
            'access_mode' => $accessMode,
            'status' => $status,
            'purchased_at' => $existing && $existing->purchased_at ? $existing->purchased_at : $this->purchaseDate($service, $orderId),
            'updated_at' => $now,
        );

        if ($existing) {
            Capsule::table('mod_digitalproducts_entitlements')->where('id', $existing->id)->update($data);
            $entitlementId = (int) $existing->id;
        } else {
            $data['download_count'] = 0;
            $data['created_at'] = $now;
            $entitlementId = Capsule::table('mod_digitalproducts_entitlements')->insertGetId($data);
        }

        $entitlement = Capsule::table('mod_digitalproducts_entitlements')->where('id', $entitlementId)->first();
        if ($product->license_enabled) {
            $license = new \DigitalProducts\License();
            $license->generateLicense(array(
                'product_id' => (int) $product->id,
                'entitlement_id' => $entitlementId,
                'service_id' => $serviceId,
                'client_id' => (int) $service->userid,
                'domain' => isset($service->domain) ? (string) $service->domain : '',
            ));
        }

        if ($sendAudit) {
            Audit::record($existing ? 'entitlement.updated' : 'entitlement.granted', 'entitlement', $entitlementId, $existing ? (array) $existing : array(), (array) $entitlement);
        }
        return $entitlement;
    }

    public function syncClientEntitlements($clientId)
    {
        $clientId = (int) $clientId;
        if (!$clientId) { return; }
        $services = Capsule::table('tblhosting')
            ->join('mod_digitalproducts_products', function ($join) {
                $join->on('mod_digitalproducts_products.product_id', '=', 'tblhosting.packageid')
                    ->orOn('mod_digitalproducts_products.whmcs_product_id', '=', 'tblhosting.packageid');
            })
            ->where('tblhosting.userid', $clientId)
            ->whereIn('tblhosting.domainstatus', array('Active', 'Suspended'))
            ->select('tblhosting.id', 'tblhosting.orderid')
            ->get();
        foreach ($services as $service) {
            $this->grantForService((int) $service->id, (int) $service->orderid, false);
        }
    }

    public function recalculateForService($serviceId, $statusOverride = null)
    {
        $serviceId = (int) $serviceId;
        $entitlements = Capsule::table('mod_digitalproducts_entitlements')->where('service_id', $serviceId)->get();
        if (!count($entitlements)) {
            $this->grantForService($serviceId, null, false);
            $entitlements = Capsule::table('mod_digitalproducts_entitlements')->where('service_id', $serviceId)->get();
        }
        $service = Capsule::table('tblhosting')->where('id', $serviceId)->first();
        foreach ($entitlements as $entitlement) {
            $status = $statusOverride ?: ($service && $this->serviceAllowsAccess($service, (int) $entitlement->order_id) ? self::STATUS_ACTIVE : $this->statusFromService($service));
            Capsule::table('mod_digitalproducts_entitlements')->where('id', $entitlement->id)->update(array('status' => $status, 'updated_at' => date('Y-m-d H:i:s')));
            if ($status !== self::STATUS_ACTIVE) {
                (new \DigitalProducts\Security\TokenService())->revokeForEntitlement((int) $entitlement->id);
                Capsule::table('mod_digitalproducts_licenses')->where('entitlement_id', $entitlement->id)->update(array('status' => $status === self::STATUS_SUSPENDED ? 'suspended' : 'cancelled', 'updated_at' => date('Y-m-d H:i:s')));
            }
            Audit::record('entitlement.recalculated', 'entitlement', $entitlement->id, (array) $entitlement, array('status' => $status));
        }
    }

    public function listClientDownloads($clientId)
    {
        $this->syncClientEntitlements($clientId);
        $rows = Capsule::table('mod_digitalproducts_entitlements as e')
            ->join('mod_digitalproducts_products as p', 'p.id', '=', 'e.product_id')
            ->leftJoin('tblhosting as h', 'h.id', '=', 'e.service_id')
            ->leftJoin('tblorders as o', 'o.id', '=', 'e.order_id')
            ->leftJoin('mod_digitalproducts_licenses as l', 'l.entitlement_id', '=', 'e.id')
            ->where('e.client_id', (int) $clientId)
            ->where('e.status', self::STATUS_ACTIVE)
            ->where('p.status', 'active')
            ->where(function ($q) { $q->whereNull('h.id')->orWhere('h.domainstatus', 'Active'); })
            ->select('e.*', 'p.product_name', 'p.name', 'p.description', 'p.short_description', 'p.product_type', 'p.current_file_id', 'p.current_version_id', 'p.download_limit', 'p.download_expiry_hours', 'p.link_expiry_hours', 'p.access_mode as product_access_mode', 'h.regdate as service_regdate', 'h.nextduedate', 'h.domainstatus', 'o.date as order_date', 'l.id as license_id', 'l.license_key', 'l.license_hash', 'l.license_prefix', 'l.license_ciphertext', 'l.status as license_status')
            ->orderBy('e.purchased_at', 'desc')
            ->get();

        $downloads = array();
        foreach ($rows as $row) {
            $fileId = $this->versionForEntitlement((object) array(
                'current_file_id' => $row->current_file_id,
                'current_version_id' => $row->current_version_id,
                'access_mode' => $row->product_access_mode,
            ), $row);
            if (!$fileId) { continue; }
            $file = Capsule::table('mod_digitalproducts_files')->where('id', $fileId)->where('status', 'active')->first();
            if (!$file) { continue; }
            $row->file_id = (int) $file->id;
            $row->version_id = (int) $file->id;
            $row->version = $file->version;
            $row->filename = $file->filename;
            $row->original_name = $file->original_name;
            $row->file_size = $file->file_size;
            $row->file_hash = $file->checksum_sha256 ?: $file->file_hash;
            $row->changelog = $file->changelog;
            $row->release_notes = $file->release_notes;
            $row->minimum_php_version = $file->minimum_php_version;
            $row->maximum_php_version = $file->maximum_php_version;
            $row->minimum_whmcs_version = $file->minimum_whmcs_version;
            $row->maximum_whmcs_version = $file->maximum_whmcs_version;
            $row->purchase_date = $row->purchased_at ?: ($row->order_date ?: $row->service_regdate);
            $row->download_limit_effective = $row->download_limit_override !== null ? (int) $row->download_limit_override : (int) $row->download_limit;
            $row->downloads_remaining = $row->download_limit_effective === 0 ? null : max(0, $row->download_limit_effective - (int) $row->download_count);
            $row->license_key_display = $row->license_id ? (new \DigitalProducts\License())->displayKey($row) : null;
            $downloads[] = $row;
        }
        return $downloads;
    }

    public function canDownload($entitlement, $product, &$reason = null)
    {
        if (!$entitlement || (string) $entitlement->status !== self::STATUS_ACTIVE) { $reason = 'not_entitled'; return false; }
        if ($entitlement->expires_at && strtotime($entitlement->expires_at) < time()) { $reason = 'expired'; return false; }
        if (!$product || (string) $product->status !== 'active') { $reason = 'disabled_product'; return false; }
        $service = Capsule::table('tblhosting')->where('id', (int) $entitlement->service_id)->first();
        if ($service && !$this->serviceAllowsAccess($service, (int) $entitlement->order_id)) { $reason = 'service_inactive'; return false; }
        $limit = $entitlement->download_limit_override !== null ? (int) $entitlement->download_limit_override : (int) $product->download_limit;
        if ($limit > 0 && (int) $entitlement->download_count >= $limit) { $reason = 'limit_exceeded'; return false; }
        return true;
    }

    public function consumeDownload($entitlement, $product)
    {
        $limit = $entitlement->download_limit_override !== null ? (int) $entitlement->download_limit_override : (int) $product->download_limit;
        $query = Capsule::table('mod_digitalproducts_entitlements')->where('id', (int) $entitlement->id)->where('status', self::STATUS_ACTIVE);
        if ($limit > 0) { $query->where('download_count', '<', $limit); }
        return $query->update(array('download_count' => Capsule::raw('download_count + 1'), 'last_download_at' => date('Y-m-d H:i:s'), 'updated_at' => date('Y-m-d H:i:s')));
    }

    public function resetDownloadCounter($entitlementId)
    {
        $before = Capsule::table('mod_digitalproducts_entitlements')->where('id', (int) $entitlementId)->first();
        if (!$before) { throw new \RuntimeException('Entitlement not found.'); }
        Capsule::table('mod_digitalproducts_entitlements')->where('id', (int) $entitlementId)->update(array('download_count' => 0, 'updated_at' => date('Y-m-d H:i:s')));
        Audit::record('entitlement.download_counter_reset', 'entitlement', $entitlementId, (array) $before, array('download_count' => 0));
    }

    public function updateStatus($entitlementId, $status)
    {
        if (!in_array($status, array(self::STATUS_ACTIVE, self::STATUS_SUSPENDED, self::STATUS_REVOKED, self::STATUS_EXPIRED), true)) { throw new \RuntimeException('Invalid entitlement status.'); }
        $before = Capsule::table('mod_digitalproducts_entitlements')->where('id', (int) $entitlementId)->first();
        if (!$before) { throw new \RuntimeException('Entitlement not found.'); }
        Capsule::table('mod_digitalproducts_entitlements')->where('id', (int) $entitlementId)->update(array('status' => $status, 'updated_at' => date('Y-m-d H:i:s')));
        if ($status !== self::STATUS_ACTIVE) { (new \DigitalProducts\Security\TokenService())->revokeForEntitlement((int) $entitlementId); }
        Audit::record($status === self::STATUS_ACTIVE ? 'entitlement.restored' : 'entitlement.revoked', 'entitlement', $entitlementId, (array) $before, array('status' => $status));
    }

    public function digitalProductForWhmcsProduct($whmcsProductId)
    {
        return Capsule::table('mod_digitalproducts_products')
            ->where(function ($q) use ($whmcsProductId) {
                $q->where('whmcs_product_id', (int) $whmcsProductId)->orWhere('product_id', (int) $whmcsProductId);
            })
            ->first();
    }

    public function versionForEntitlement($product, $entitlement = null)
    {
        $accessMode = $entitlement && isset($entitlement->access_mode) ? (string) $entitlement->access_mode : (isset($product->access_mode) ? (string) $product->access_mode : 'CURRENT_VERSION');
        if ($accessMode === 'PURCHASE_VERSION' && $entitlement && !empty($entitlement->purchase_version_id)) { return (int) $entitlement->purchase_version_id; }
        if (!empty($product->current_version_id)) { return (int) $product->current_version_id; }
        if (!empty($product->current_file_id)) { return (int) $product->current_file_id; }
        return 0;
    }

    private function serviceAllowsAccess($service, $orderId)
    {
        if (!$service) { return false; }
        $status = isset($service->domainstatus) ? (string) $service->domainstatus : '';
        if ($status !== 'Active') { return false; }
        $orderId = (int) $orderId;
        if ($orderId > 0 && Capsule::schema()->hasTable('tblorders')) {
            $order = Capsule::table('tblorders')->where('id', $orderId)->first();
            if ($order && in_array((string) $order->status, array('Cancelled', 'Fraud'), true)) { return false; }
        }
        return true;
    }

    private function statusFromService($service)
    {
        if (!$service) { return self::STATUS_REVOKED; }
        $status = (string) $service->domainstatus;
        if ($status === 'Suspended') { return self::STATUS_SUSPENDED; }
        if (in_array($status, array('Cancelled', 'Terminated', 'Fraud'), true)) { return self::STATUS_REVOKED; }
        return self::STATUS_SUSPENDED;
    }

    private function purchaseDate($service, $orderId)
    {
        try {
            if ($orderId > 0) {
                $orderDate = Capsule::table('tblorders')->where('id', $orderId)->value('date');
                if ($orderDate) { return $orderDate; }
            }
        } catch (\Throwable $ignored) {}
        return isset($service->regdate) && $service->regdate ? $service->regdate : date('Y-m-d H:i:s');
    }
}
