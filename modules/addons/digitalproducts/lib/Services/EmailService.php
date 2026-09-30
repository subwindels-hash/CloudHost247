<?php
namespace DigitalProducts\Services;

use DigitalProducts\Security\DownloadAuthorizer;
use WHMCS\Database\Capsule;

final class EmailService
{
    const PURCHASE_TEMPLATE = 'CloudHost247 Digital Product Ready';
    const UPDATE_TEMPLATE = 'CloudHost247 Digital Product Update Available';

    public function ensureTemplates()
    {
        $this->ensureTemplate(self::PURCHASE_TEMPLATE, 'Your CloudHost247 digital product is ready - {$product_name}', $this->purchaseMessage());
        $this->ensureTemplate(self::UPDATE_TEMPLATE, 'CloudHost247 product update available - {$product_name} {$product_version}', $this->updateMessage());
    }

    public function sendPurchaseEmail($entitlement, $licenseKey = null)
    {
        try {
            $this->ensureTemplates();
            $product = Capsule::table('mod_digitalproducts_products')->where('id', (int) $entitlement->product_id)->first();
            $fileId = (new EntitlementService())->versionForEntitlement($product, $entitlement);
            $file = Capsule::table('mod_digitalproducts_files')->where('id', (int) $fileId)->first();
            if (!$product || !$file) { return false; }
            $downloadLink = $this->downloadLink($entitlement, (int) $file->id);
            $merge = array(
                'product_name' => $product->product_name,
                'product_version' => $file->version,
                'purchase_date' => $entitlement->purchased_at,
                'license_key' => $licenseKey ?: 'Not applicable',
                'download_link' => $downloadLink,
                'client_area_link' => $this->systemUrl() . '/index.php?m=digitalproducts&action=downloads',
                'support_link' => $this->systemUrl() . '/submitticket.php',
            );
            if (function_exists('sendMessage')) { sendMessage(self::PURCHASE_TEMPLATE, (int) $entitlement->service_id, $merge); return true; }
        } catch (\Throwable $e) {
            if (function_exists('logActivity')) { logActivity('DigitalProducts email delivery failed: ' . $e->getMessage()); }
        }
        return false;
    }

    public function sendUpdateEmail($entitlement, $product, $file)
    {
        try {
            $this->ensureTemplates();
            $merge = array(
                'product_name' => $product->product_name,
                'product_version' => $file->version,
                'client_area_link' => $this->systemUrl() . '/index.php?m=digitalproducts&action=downloads',
                'release_notes' => $file->release_notes ?: $file->changelog,
            );
            if (function_exists('sendMessage')) { sendMessage(self::UPDATE_TEMPLATE, (int) $entitlement->service_id, $merge); return true; }
        } catch (\Throwable $e) {
            if (function_exists('logActivity')) { logActivity('DigitalProducts update email failed: ' . $e->getMessage()); }
        }
        return false;
    }

    private function downloadLink($entitlement, $fileId)
    {
        try {
            $singleUse = $this->setting('single_use_tokens', 'on') === 'on';
            $token = (new DownloadAuthorizer())->generateTokenForClient((int) $entitlement->client_id, (int) $entitlement->service_id, (int) $fileId, $singleUse);
            return $this->systemUrl() . '/modules/addons/digitalproducts/download.php?token=' . rawurlencode($token['token']);
        } catch (\Throwable $e) {
            return $this->systemUrl() . '/index.php?m=digitalproducts&action=downloads';
        }
    }

    private function ensureTemplate($name, $subject, $message)
    {
        try {
            if (!Capsule::schema()->hasTable('tblemailtemplates')) { return; }
            $exists = Capsule::table('tblemailtemplates')->where('name', $name)->exists();
            if ($exists) { return; }
            Capsule::table('tblemailtemplates')->insert(array(
                'type' => 'product',
                'name' => $name,
                'subject' => $subject,
                'message' => $message,
                'plaintext' => 0,
                'disabled' => 0,
                'custom' => 1,
                'language' => '',
                'copyto' => '',
                'blind_copy_to' => '',
            ));
        } catch (\Throwable $ignored) {}
    }

    private function purchaseMessage()
    {
        return '<p>Dear {$client_name},</p><p>Thank you for your purchase. Your CloudHost247 digital product <strong>{$product_name}</strong> is ready.</p><p><strong>Version:</strong> {$product_version}<br><strong>Purchase date:</strong> {$purchase_date}<br><strong>License:</strong> {$license_key}</p><p><a href="{$download_link}" style="background:#2563eb;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;">Download securely</a></p><p>This link is time-limited. You can access your downloads anytime from your CloudHost247 client area: <a href="{$client_area_link}">My Downloads</a>.</p><p>If you need help, contact support: <a href="{$support_link}">CloudHost247 Support</a>.</p>';
    }

    private function updateMessage()
    {
        return '<p>Dear {$client_name},</p><p>A new version of <strong>{$product_name}</strong> is available.</p><p><strong>Version:</strong> {$product_version}</p><p>{$release_notes}</p><p>Please sign in to your CloudHost247 client area to download it: <a href="{$client_area_link}">My Downloads</a>.</p>';
    }

    private function systemUrl()
    {
        try { $url = Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value'); } catch (\Throwable $e) { $url = ''; }
        $url = rtrim((string) $url, '/');
        return $url !== '' ? $url : '';
    }

    private function setting($key, $default)
    {
        try {
            $value = Capsule::table('tbladdonmodules')->where('module', 'digitalproducts')->where('setting', $key)->value('value');
            return $value !== null ? (string) $value : $default;
        } catch (\Throwable $e) { return $default; }
    }
}
