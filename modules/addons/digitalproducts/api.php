<?php
/** CloudHost247 Digital Products JSON API. */
require_once __DIR__ . '/../../../init.php';
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use DigitalProducts\Core;
use DigitalProducts\License;
use DigitalProducts\Security\DownloadAuthorizer;
use DigitalProducts\Security\RateLimiter;
use DigitalProducts\Support\Audit;
use WHMCS\Database\Capsule;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function dp_json($payload, $code = 200)
{
    http_response_code($code);
    echo json_encode($payload, JSON_PRETTY_PRINT);
    exit;
}

function dp_method($method)
{
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== strtoupper($method)) {
        dp_json(array('status' => 'error', 'message' => 'Method not allowed'), 405);
    }
}

function dp_input($key, $default = '')
{
    return isset($_POST[$key]) ? trim((string) $_POST[$key]) : (isset($_GET[$key]) ? trim((string) $_GET[$key]) : $default);
}

function dp_client_from_bearer()
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/Bearer\s+(.+)/i', $header, $m)) { return 0; }
    $token = trim($m[1]);
    if ($token === '' || strlen($token) > 256) { return 0; }
    $hash = hash('sha256', $token);
    try {
        $row = Capsule::table('mod_digitalproducts_api_tokens')
            ->where(function ($q) use ($hash, $token) { $q->where('api_token_hash', $hash)->orWhere('api_token', $token); })
            ->where(function ($q) { $q->whereNull('expires_at')->orWhere('expires_at', '>', date('Y-m-d H:i:s')); })
            ->where(function ($q) { $q->whereNull('status')->orWhere('status', 'active'); })
            ->first();
        if (!$row) { return 0; }
        if (!empty($row->ip_restriction)) {
            $ip = $_SERVER['REMOTE_ADDR'] ?? '';
            $allowed = array_map('trim', explode(',', (string) $row->ip_restriction));
            if (!in_array($ip, $allowed, true)) { return 0; }
        }
        Capsule::table('mod_digitalproducts_api_tokens')->where('id', $row->id)->update(array('last_used_at' => date('Y-m-d H:i:s')));
        return (int) $row->client_id;
    } catch (\Throwable $e) { return 0; }
}

function dp_authenticated_client()
{
    $clientId = dp_client_from_bearer();
    if ($clientId) { return $clientId; }
    return (int) ($_SESSION['uid'] ?? 0);
}

function dp_require_client()
{
    $clientId = dp_authenticated_client();
    if (!$clientId) { dp_json(array('status' => 'error', 'message' => 'Authentication required'), 401); }
    return $clientId;
}

try {
    if (class_exists('CloudHost247\\Foundation\\Database\\MigrationRunner')) {
        (new \CloudHost247\Foundation\Database\MigrationRunner())->run('digitalproducts', array(new \DigitalProducts\Migrations\DigitalProductsInitialMigration()));
    }
} catch (\Throwable $ignored) {}

$core = new Core();
$settings = $core->getSettings();
$endpoint = preg_replace('/[^a-z-]/', '', (string) ($_GET['endpoint'] ?? ''));

try {
    switch ($endpoint) {
        case 'products':
            dp_method('GET');
            $products = Capsule::table('mod_digitalproducts_products')
                ->where('status', 'active')
                ->whereNotNull('current_version_id')
                ->select('id', 'slug', 'product_name as name', 'short_description', 'description', 'product_type', 'current_version_id', 'updated_at')
                ->orderBy('product_name')
                ->get();
            dp_json(array('status' => 'success', 'data' => $products));

        case 'product':
            dp_method('GET');
            $id = dp_input('id'); $slug = dp_input('slug');
            $query = Capsule::table('mod_digitalproducts_products')->where('status', 'active');
            if ($id !== '') { $query->where('id', (int) $id); } else { $query->where('slug', substr($slug, 0, 191)); }
            $product = $query->select('id', 'slug', 'product_name as name', 'short_description', 'description', 'product_type', 'current_version_id', 'updated_at')->first();
            if (!$product) { dp_json(array('status' => 'error', 'message' => 'Not found'), 404); }
            dp_json(array('status' => 'success', 'data' => $product));

        case 'versions':
            dp_method('GET');
            $productId = (int) dp_input('product_id');
            $product = Capsule::table('mod_digitalproducts_products')->where('id', $productId)->where('status', 'active')->first();
            if (!$product) { dp_json(array('status' => 'error', 'message' => 'Not found'), 404); }
            $versions = Capsule::table('mod_digitalproducts_files')
                ->where('product_id', $productId)->where('status', 'active')
                ->select('id', 'version', 'original_name', 'file_size', 'checksum_sha256', 'release_notes', 'changelog', 'minimum_php_version', 'maximum_php_version', 'minimum_whmcs_version', 'maximum_whmcs_version', 'release_date', 'created_at')
                ->orderBy('created_at', 'desc')->get();
            dp_json(array('status' => 'success', 'data' => $versions));

        case 'my-downloads':
            dp_method('GET');
            $clientId = dp_require_client();
            $items = array();
            foreach ($core->getClientDownloads($clientId) as $d) {
                $items[] = array(
                    'entitlement_id' => (int) $d->id,
                    'service_id' => (int) $d->service_id,
                    'product_id' => (int) $d->product_id,
                    'product_name' => $d->product_name,
                    'version' => $d->version,
                    'file_size' => (int) $d->file_size,
                    'checksum_sha256' => $d->file_hash,
                    'license_key' => $d->license_key_display,
                    'license_status' => $d->license_status,
                    'purchase_date' => $d->purchase_date,
                    'download_count' => (int) $d->download_count,
                    'download_limit' => (int) $d->download_limit_effective,
                    'downloads_remaining' => $d->downloads_remaining,
                );
            }
            dp_json(array('status' => 'success', 'data' => $items));

        case 'generate-download-token':
        case 'download-link':
            dp_method('POST');
            $clientId = dp_require_client();
            $serviceId = (int) dp_input('service_id');
            $fileId = (int) dp_input('file_id');
            $token = (new DownloadAuthorizer())->generateTokenForClient($clientId, $serviceId, $fileId, (($settings['single_use_tokens'] ?? 'on') === 'on'));
            $url = rtrim((string) Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value'), '/') . '/modules/addons/digitalproducts/download.php?token=' . rawurlencode($token['token']);
            dp_json(array('status' => 'success', 'data' => array('download_url' => $url, 'expires_at' => $token['expires_at'])));

        case 'license':
            dp_method('GET');
            $clientId = dp_require_client();
            $serviceId = (int) dp_input('service_id');
            $license = Capsule::table('mod_digitalproducts_licenses')->where('client_id', $clientId)->where('service_id', $serviceId)->first();
            if (!$license) { dp_json(array('status' => 'error', 'message' => 'Not found'), 404); }
            dp_json(array('status' => 'success', 'data' => array('service_id' => (int) $license->service_id, 'product_id' => (int) $license->product_id, 'license_key' => (new License())->displayKey($license), 'status' => $license->status, 'expires_at' => $license->expires_at)));

        case 'my-licenses':
            dp_method('GET');
            $clientId = dp_require_client();
            dp_json(array('status' => 'success', 'data' => (new License())->getClientLicenses($clientId)));

        case 'validate-license':
            dp_method('POST');
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
            if (!(new RateLimiter())->hit('validate-license', $ip, (int) ($settings['api_rate_limit'] ?? 60), 3600)) {
                Audit::record('license.validate.rate_limited', 'ip', hash('sha256', $ip), array(), array(), 'denied', 'Rate limit exceeded');
                dp_json(array('valid' => false, 'status' => 'invalid'), 429);
            }
            $result = (new License())->validateLicense(dp_input('license_key'), dp_input('domain'), dp_input('product'));
            if (!$result['valid']) { dp_json(array('valid' => false, 'status' => 'invalid')); }
            $license = $result['license'];
            dp_json(array('valid' => true, 'status' => $license->status, 'product' => $license->product_name, 'expires_at' => $license->expires_at));

        case 'activate-license':
            dp_method('POST');
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
            if (!(new RateLimiter())->hit('activate-license', $ip, (int) ($settings['api_rate_limit'] ?? 60), 3600)) { dp_json(array('success' => false, 'status' => 'invalid'), 429); }
            $result = (new License())->activateLicense(dp_input('license_key'), dp_input('domain'));
            if (!$result['success']) { dp_json(array('success' => false, 'status' => 'invalid')); }
            dp_json(array('success' => true, 'status' => $result['status'] ?? 'active'));

        default:
            dp_json(array('status' => 'error', 'message' => 'Unknown endpoint', 'endpoints' => array('products', 'product', 'versions', 'my-downloads', 'generate-download-token', 'license', 'my-licenses', 'validate-license', 'activate-license')), 404);
    }
} catch (\Throwable $e) {
    if (function_exists('logActivity')) { logActivity('DigitalProducts API error: ' . $e->getMessage()); }
    Audit::record('api.request.failed', 'endpoint', $endpoint, array(), array(), 'failed', $e->getMessage());
    dp_json(array('status' => 'error', 'message' => 'Request failed'), 500);
}
