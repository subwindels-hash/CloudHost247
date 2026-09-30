<?php
/**
 * CloudHost247 Digital Products Marketplace
 *
 * WHMCS-product-linked secure downloads, versioning, entitlements, license keys,
 * hashed expiring tokens, private storage and CloudHost247 Foundation audit.
 */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use CloudHost247\Foundation\Database\MigrationRunner;
use DigitalProducts\Migrations\DigitalProductsInitialMigration;
use DigitalProducts\Security\CapabilityPolicy;
use DigitalProducts\Services\EmailService;
use DigitalProducts\Storage\LocalPrivateStorage;

function digitalproducts_config()
{
    return array(
        'name' => 'CloudHost247 Digital Products Marketplace',
        'description' => 'Native CloudHost247 commerce capability for WHMCS-linked downloadable products with secure private storage, version management, entitlements, licenses, audit and APIs.',
        'author' => 'CloudHost247',
        'language' => 'english',
        'version' => '2.0.0',
        'fields' => array(
            'download_limit' => array('FriendlyName'=>'Default Download Limit','Type'=>'text','Size'=>'5','Default'=>'5','Description'=>'Maximum successful downloads per entitlement (0 = unlimited).'),
            'download_expiry_hours' => array('FriendlyName'=>'Default Token Expiry Hours','Type'=>'text','Size'=>'5','Default'=>'48','Description'=>'Hours before generated download tokens expire (0 = never; time-limited is recommended).'),
            'default_access_mode' => array('FriendlyName'=>'Default Version Access Mode','Type'=>'dropdown','Options'=>'CURRENT_VERSION,PURCHASE_VERSION','Default'=>'CURRENT_VERSION','Description'=>'Current version lets existing customers receive the latest active version; purchase version locks to the purchased release.'),
            'license_enabled' => array('FriendlyName'=>'Enable License Keys','Type'=>'yesno','Default'=>'on','Description'=>'Generate bound license keys for products by default.'),
            'email_delivery' => array('FriendlyName'=>'Email Download Info','Type'=>'yesno','Default'=>'on','Description'=>'Send WHMCS email after entitlement creation. Failure never rolls back payment/access.'),
            'update_notifications' => array('FriendlyName'=>'Update Notifications','Type'=>'yesno','Default'=>'','Description'=>'Notify active entitlement owners when a newly uploaded version is published as current.'),
            'single_use_tokens' => array('FriendlyName'=>'Single-use Download Tokens','Type'=>'yesno','Default'=>'on','Description'=>'Limit generated download tokens to one successful use.'),
            'allowed_extensions' => array('FriendlyName'=>'Allowed File Extensions','Type'=>'text','Size'=>'60','Default'=>'zip,tar.gz,pdf,js,css,php,json,xml,txt,md,html,htm','Description'=>'Comma-separated extensions accepted by admin upload validation.'),
            'max_upload_size' => array('FriendlyName'=>'Maximum Upload Size (bytes)','Type'=>'text','Size'=>'12','Default'=>'524288000','Description'=>'Maximum digital-product upload size; PHP upload limits still apply.'),
            'storage_path' => array('FriendlyName'=>'Private Storage Path','Type'=>'text','Size'=>'60','Default'=>'','Description'=>'Absolute path outside public_html where possible. Empty uses CH247_MODULE_STORAGE/digital-products or WHMCS_ROOT/storage/digitalproducts.'),
            'api_rate_limit' => array('FriendlyName'=>'API Rate Limit / Hour','Type'=>'text','Size'=>'5','Default'=>'60','Description'=>'Per-IP throttle for public license validation/activation endpoints.'),
        ),
    );
}

function digitalproducts_activate()
{
    try {
        $applied = digitalproducts_run_migrations();
        $seed = CapabilityPolicy::seedDefaults();
        (new EmailService())->ensureTemplates();
        $storage = new LocalPrivateStorage();
        $description = 'Digital Products Marketplace installed non-destructively. Applied migrations: ' . ($applied ? implode(', ', $applied) : 'already current') . '. ' . CapabilityPolicy::describeSeeding($seed);
        $description .= ' Storage: ' . $storage->root() . ' (' . $storage->describeSource() . ').';
        if (!$storage->available()) { $description .= ' WARNING: storage is not writable.'; }
        if ($storage->isInsideDocumentRoot()) { $description .= ' WARNING: storage is inside WHMCS_ROOT; set CH247_MODULE_STORAGE or Private Storage Path outside the webroot for production.'; }
        return array('status' => 'success', 'description' => $description);
    } catch (\Throwable $e) {
        return array('status' => 'error', 'description' => 'Digital Products activation failed: ' . $e->getMessage());
    }
}

function digitalproducts_deactivate()
{
    return array('status' => 'success', 'description' => 'Module deactivated. Tables, private files, entitlements, licenses and audit records were preserved for safe rollback.');
}

function digitalproducts_upgrade($vars)
{
    try { digitalproducts_run_migrations(); CapabilityPolicy::seedDefaults(); (new EmailService())->ensureTemplates(); }
    catch (\Throwable $e) { if (function_exists('logActivity')) { logActivity('DigitalProducts upgrade error: ' . $e->getMessage()); } }
}

function digitalproducts_output($vars)
{
    try { digitalproducts_run_migrations(); } catch (\Throwable $ignored) {}
    require_once __DIR__ . '/lib/Admin.php';
    $admin = new DigitalProducts\Admin($vars);
    return $admin->render();
}

function digitalproducts_sidebar($vars)
{
    $moduleLink = isset($vars['modulelink']) ? (string) $vars['modulelink'] : 'addonmodules.php?module=digitalproducts';
    $e = function ($v) { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); };
    $items = array(
        'dashboard' => array('fa-dashboard', 'Dashboard'),
        'products' => array('fa-cubes', 'Digital Products'),
        'upload' => array('fa-upload', 'Upload File'),
        'versions' => array('fa-code-fork', 'Versions'),
        'entitlements' => array('fa-users', 'Entitlements'),
        'licenses' => array('fa-key', 'Licenses'),
        'downloads' => array('fa-download', 'Download Logs'),
        'customers' => array('fa-users', 'Customers'),
        'api' => array('fa-plug', 'API'),
        'settings' => array('fa-cog', 'Settings'),
        'audit' => array('fa-shield', 'Audit Log'),
    );
    $html = '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title"><i class="fa fa-bars"></i> Digital Products</h3></div><div class="list-group">';
    foreach ($items as $action => $item) { $html .= '<a href="' . $e($moduleLink . '&action=' . $action) . '" class="list-group-item"><i class="fa ' . $e($item[0]) . ' fa-fw"></i> ' . $e($item[1]) . '</a>'; }
    $html .= '</div></div><div class="panel panel-info"><div class="panel-heading"><h3 class="panel-title">Module Info</h3></div><div class="panel-body"><p><strong>Version:</strong> ' . $e($vars['version'] ?? '2.0.0') . '</p><p><strong>Runtime:</strong> PHP ' . $e(PHP_VERSION) . '</p><p class="small text-muted">WHMCS 8.x compatible. Deactivation preserves all production data.</p></div></div>';
    return $html;
}

function digitalproducts_run_migrations()
{
    if (!class_exists('CloudHost247\\Foundation\\Database\\MigrationRunner')) {
        throw new RuntimeException('CloudHost247 Foundation migration runner is required. Activate CloudHost247 Foundation first.');
    }
    return (new MigrationRunner())->run('digitalproducts', array(new DigitalProductsInitialMigration()));
}
