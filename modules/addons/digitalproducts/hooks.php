<?php
/** CloudHost247 Digital Products Marketplace WHMCS hooks. */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use DigitalProducts\Core;
use DigitalProducts\Services\EmailService;
use DigitalProducts\Services\EntitlementService;
use DigitalProducts\Support\Audit;
use WHMCS\Database\Capsule;

function digitalproducts_safe_migrate()
{
    try {
        if (function_exists('digitalproducts_run_migrations')) { digitalproducts_run_migrations(); return; }
        if (class_exists('CloudHost247\\Foundation\\Database\\MigrationRunner')) {
            (new \CloudHost247\Foundation\Database\MigrationRunner())->run('digitalproducts', array(new \DigitalProducts\Migrations\DigitalProductsInitialMigration()));
        }
    } catch (\Throwable $ignored) {}
}

function digitalproducts_entitle_service($serviceId, $orderId = null, $email = true)
{
    digitalproducts_safe_migrate();
    $serviceId = (int) $serviceId;
    if (!$serviceId) { return; }
    $existing = Capsule::table('mod_digitalproducts_entitlements')->where('service_id', $serviceId)->first();
    $entitlement = (new EntitlementService())->grantForService($serviceId, $orderId, true);
    if (!$entitlement) { return; }
    if (!$existing && $email && (string) $entitlement->status === EntitlementService::STATUS_ACTIVE) {
        $settings = (new Core())->getSettings();
        if (($settings['email_delivery'] ?? 'on') === 'on') {
            $license = Capsule::table('mod_digitalproducts_licenses')->where('entitlement_id', $entitlement->id)->first();
            $licenseKey = $license ? (new DigitalProducts\License())->displayKey($license) : null;
            (new EmailService())->sendPurchaseEmail($entitlement, $licenseKey);
        }
    }
}

add_hook('OrderPaid', 1, function ($vars) {
    try {
        digitalproducts_safe_migrate();
        $orderId = (int) ($vars['orderId'] ?? $vars['orderid'] ?? 0);
        if (!$orderId) { return; }
        $services = Capsule::table('tblhosting')
            ->join('mod_digitalproducts_products', 'mod_digitalproducts_products.whmcs_product_id', '=', 'tblhosting.packageid')
            ->where('tblhosting.orderid', $orderId)
            ->where('mod_digitalproducts_products.status', 'active')
            ->select('tblhosting.id')
            ->get();
        foreach ($services as $service) { digitalproducts_entitle_service((int) $service->id, $orderId, true); }
    } catch (\Throwable $e) {
        if (function_exists('logActivity')) { logActivity('DigitalProducts OrderPaid hook error: ' . $e->getMessage()); }
        Audit::record('entitlement.grant.failed', 'order', $vars['orderId'] ?? 0, array(), array(), 'failed', $e->getMessage());
    }
});

add_hook('AfterModuleCreate', 1, function ($vars) {
    try {
        $serviceId = (int) ($vars['params']['serviceid'] ?? $vars['serviceid'] ?? 0);
        if ($serviceId) { digitalproducts_entitle_service($serviceId, null, true); }
    } catch (\Throwable $e) { if (function_exists('logActivity')) { logActivity('DigitalProducts AfterModuleCreate hook error: ' . $e->getMessage()); } }
});

foreach (array('AfterModuleSuspend' => EntitlementService::STATUS_SUSPENDED, 'AfterModuleTerminate' => EntitlementService::STATUS_REVOKED) as $hook => $status) {
    add_hook($hook, 1, function ($vars) use ($status, $hook) {
        try {
            $serviceId = (int) ($vars['params']['serviceid'] ?? $vars['serviceid'] ?? 0);
            if ($serviceId) { (new EntitlementService())->recalculateForService($serviceId, $status); }
        } catch (\Throwable $e) { if (function_exists('logActivity')) { logActivity('DigitalProducts ' . $hook . ' hook error: ' . $e->getMessage()); } }
    });
}

add_hook('AfterModuleUnsuspend', 1, function ($vars) {
    try {
        $serviceId = (int) ($vars['params']['serviceid'] ?? $vars['serviceid'] ?? 0);
        if ($serviceId) { (new EntitlementService())->recalculateForService($serviceId, null); }
    } catch (\Throwable $e) { if (function_exists('logActivity')) { logActivity('DigitalProducts AfterModuleUnsuspend hook error: ' . $e->getMessage()); } }
});

add_hook('CancellationRequest', 1, function ($vars) {
    try {
        $serviceId = (int) ($vars['relid'] ?? $vars['serviceid'] ?? 0);
        if ($serviceId) { (new EntitlementService())->recalculateForService($serviceId, EntitlementService::STATUS_REVOKED); }
    } catch (\Throwable $e) { if (function_exists('logActivity')) { logActivity('DigitalProducts CancellationRequest hook error: ' . $e->getMessage()); } }
});

add_hook('InvoiceRefunded', 1, function ($vars) {
    try {
        $invoiceId = (int) ($vars['invoiceid'] ?? $vars['invoiceId'] ?? 0);
        if (!$invoiceId || !Capsule::schema()->hasTable('tblinvoiceitems')) { return; }
        $serviceIds = Capsule::table('tblinvoiceitems')->where('invoiceid', $invoiceId)->where('type', 'Hosting')->pluck('relid')->toArray();
        foreach ($serviceIds as $serviceId) { (new EntitlementService())->recalculateForService((int) $serviceId, EntitlementService::STATUS_REVOKED); }
    } catch (\Throwable $e) { if (function_exists('logActivity')) { logActivity('DigitalProducts InvoiceRefunded hook error: ' . $e->getMessage()); } }
});

add_hook('ClientAreaPrimarySidebar', 1, function ($sidebar) {
    try {
        if (empty($_SESSION['uid'])) { return; }
        $clientId = (int) $_SESSION['uid'];
        $hasAccess = Capsule::table('mod_digitalproducts_entitlements')->where('client_id', $clientId)->where('status', 'active')->exists();
        if (!$hasAccess) {
            $hasAccess = Capsule::table('tblhosting')
                ->join('mod_digitalproducts_products', 'mod_digitalproducts_products.whmcs_product_id', '=', 'tblhosting.packageid')
                ->where('tblhosting.userid', $clientId)->where('tblhosting.domainstatus', 'Active')->exists();
        }
        if (!$hasAccess) { return; }
        $children = $sidebar->getChildren();
        $parent = isset($children['My Account']) ? $children['My Account'] : (isset($children['Services']) ? $children['Services'] : null);
        if (!$parent) { return; }
        if (isset($parent->getChildren()['My Downloads'])) { return; }
        $parent->addChild('My Downloads', array('label' => 'My Downloads', 'uri' => 'index.php?m=digitalproducts&action=downloads', 'icon' => 'fa-download', 'order' => 50));
    } catch (\Throwable $ignored) {}
});

add_hook('DailyCronJob', 1, function () {
    try {
        digitalproducts_safe_migrate();
        $now = date('Y-m-d H:i:s');
        Capsule::table('mod_digitalproducts_download_tokens')->whereNull('revoked_at')->whereNotNull('expires_at')->where('expires_at', '<', $now)->update(array('revoked_at' => $now));
        Capsule::table('mod_digitalproducts_rate_limits')->where('window_start', '<', date('Y-m-d H:i:s', strtotime('-2 days')))->delete();
        // Keep download/audit logs for auditability; retention should be handled
        // by an explicit administrator policy, not by default cron deletion.
    } catch (\Throwable $e) { if (function_exists('logActivity')) { logActivity('DigitalProducts DailyCronJob hook error: ' . $e->getMessage()); } }
});

add_hook('AdminAreaHeadOutput', 1, function ($vars) {
    $filename = $vars['filename'] ?? '';
    if ($filename !== 'addonmodules' || ($_GET['module'] ?? '') !== 'digitalproducts') { return ''; }
    return <<<HTML
<style>
.digitalproducts-admin .dp-stat-card{background:#fff;border:1px solid #d9e2ef;border-radius:10px;margin-bottom:18px;padding:18px;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.digitalproducts-admin .dp-stat-card .number{color:#2563eb;font-size:28px;font-weight:700;line-height:1}.digitalproducts-admin .dp-stat-card .label{color:#64748b;font-size:12px;margin-top:6px;text-transform:uppercase;white-space:normal}.digitalproducts-admin .dp-version-badge{background:#0f4c81;border-radius:4px;color:#fff;display:inline-block;font-size:12px;padding:3px 8px}.digitalproducts-admin code{overflow-wrap:anywhere}.digitalproducts-admin .dp-header{background:linear-gradient(135deg,#0f4c81,#2563eb);border-radius:10px;color:#fff;margin-bottom:20px;padding:20px 24px}.digitalproducts-admin .dp-header h2{margin-top:0}.digitalproducts-admin .dp-header .text-muted{color:#dbeafe}
@media(max-width:767px){.digitalproducts-admin .nav-tabs>li{float:none}.digitalproducts-admin .form-inline .form-control{display:block;margin-bottom:8px;width:100%}.digitalproducts-admin .table-responsive{border:0}}
</style>
HTML;
});
