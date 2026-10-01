<?php
/** CloudHost247 Digital Products secure download endpoint. */
require_once __DIR__ . '/../../../init.php';
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use DigitalProducts\Core;
use DigitalProducts\Security\DownloadAuthorizer;
use DigitalProducts\Support\Audit;

function dp_download_client_id()
{
    return (int) ($_SESSION['uid'] ?? 0);
}

function dp_download_error($status, $title, $message, $httpCode = 403)
{
    while (ob_get_level()) { ob_end_clean(); }
    http_response_code($httpCode);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo '<!doctype html><html><head><meta charset="utf-8"><title>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</title><style>body{font-family:Arial,sans-serif;background:#f8fafc;color:#1f2937;padding:40px}.box{max-width:680px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:10px;padding:28px}.btn{display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none}</style></head><body><div class="box"><h1>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h1><p>' . htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</p><p><a class="btn" href="../../../index.php?m=digitalproducts&action=downloads">Return to My Downloads</a></p></div></body></html>';
    exit;
}

function dp_download_check_client_csrf()
{
    if (!function_exists('check_token')) { return; }
    $token = isset($_POST['token']) ? (string) $_POST['token'] : '';
    if ($token === '') { throw new RuntimeException('Missing CSRF token.'); }
    $_REQUEST['token'] = $token;
    $ok = check_token('WHMCS.default');
    if ($ok === false) { throw new RuntimeException('Invalid or expired CSRF token.'); }
}

function dp_download_content_disposition($filename)
{
    $fallback = preg_replace('/[^A-Za-z0-9._-]/', '_', basename((string) $filename));
    if ($fallback === '') { $fallback = 'download.bin'; }
    return 'attachment; filename="' . str_replace('"', '', $fallback) . '"; filename*=UTF-8' . "''" . rawurlencode($fallback);
}

try {
    if (class_exists('CloudHost247\\Foundation\\Database\\MigrationRunner')) {
        (new \CloudHost247\Foundation\Database\MigrationRunner())->run('digitalproducts', array(new \DigitalProducts\Migrations\DigitalProductsInitialMigration()));
    }
} catch (\Throwable $ignored) {}

$core = new Core();
$authorizer = new DownloadAuthorizer();

try {
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $clientId = dp_download_client_id();
        if (!$clientId) { dp_download_error('not_authenticated', 'Sign in required', 'Please sign in before generating a download link.', 401); }
        dp_download_check_client_csrf();
        $serviceId = (int) ($_POST['service_id'] ?? 0);
        $fileId = (int) ($_POST['file_id'] ?? 0);
        $token = $authorizer->generateTokenForClient($clientId, $serviceId, $fileId, (($core->getSettings()['single_use_tokens'] ?? 'on') === 'on'));
        header('Location: download.php?token=' . rawurlencode($token['token']));
        exit;
    }

    $rawToken = isset($_GET['token']) ? (string) $_GET['token'] : '';
    if ($rawToken === '') { dp_download_error('invalid_request', 'Invalid request', 'A secure download token is required.', 400); }

    $auth = $authorizer->authorizeToken($rawToken, dp_download_client_id());
    if (!$auth['allowed']) {
        $token = isset($auth['token']) ? $auth['token'] : null;
        $entitlement = isset($auth['entitlement']) ? $auth['entitlement'] : null;
        $product = isset($auth['product']) ? $auth['product'] : null;
        $file = isset($auth['file']) ? $auth['file'] : null;
        $core->logDownload(array(
            'file_id' => $file ? $file->id : ($token ? $token->file_id : 0),
            'product_id' => $product ? $product->id : ($entitlement ? $entitlement->product_id : 0),
            'service_id' => $entitlement ? $entitlement->service_id : ($token ? $token->service_id : 0),
            'order_id' => $entitlement ? $entitlement->order_id : 0,
            'client_id' => $entitlement ? $entitlement->client_id : ($token ? $token->client_id : 0),
            'token_id' => $token ? $token->id : null,
            'status' => $auth['status'],
            'failure_reason' => $auth['message'],
            'download_token' => $rawToken,
        ));
        dp_download_error($auth['status'], 'Download unavailable', $auth['message'], 403);
    }

    $consume = $authorizer->consumeAuthorized($auth);
    if (!$consume['success']) {
        $core->logDownload(array(
            'file_id' => $auth['file']->id,
            'product_id' => $auth['product']->id,
            'service_id' => $auth['entitlement']->service_id,
            'order_id' => $auth['entitlement']->order_id,
            'client_id' => $auth['entitlement']->client_id,
            'token_id' => $auth['token']->id,
            'status' => $consume['status'],
            'failure_reason' => $consume['message'],
            'download_token' => $rawToken,
        ));
        dp_download_error($consume['status'], 'Download unavailable', $consume['message'], 403);
    }

    $core->logDownload(array(
        'file_id' => $auth['file']->id,
        'version_id' => $auth['file']->id,
        'product_id' => $auth['product']->id,
        'service_id' => $auth['entitlement']->service_id,
        'order_id' => $auth['entitlement']->order_id,
        'client_id' => $auth['entitlement']->client_id,
        'token_id' => $auth['token']->id,
        'status' => 'success',
        'download_token' => $rawToken,
    ));
    $core->incrementFileDownloadCount((int) $auth['file']->id);
    Audit::record('download.success', 'version', $auth['file']->id, array(), array('client_id' => $auth['entitlement']->client_id, 'service_id' => $auth['entitlement']->service_id));

    while (ob_get_level()) { ob_end_clean(); }
    $path = $auth['path'];
    $size = filesize($path);
    $start = 0; $end = $size - 1; $statusCode = 200;
    if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
        if ($m[1] !== '') { $start = max(0, (int) $m[1]); }
        if ($m[2] !== '') { $end = min($end, (int) $m[2]); }
        if ($start > $end || $start >= $size) {
            http_response_code(416);
            header('Content-Range: bytes */' . $size);
            exit;
        }
        $statusCode = 206;
    }
    $length = $end - $start + 1;
    http_response_code($statusCode);
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: ' . dp_download_content_disposition($auth['file']->original_name));
    header('Content-Length: ' . $length);
    header('Accept-Ranges: bytes');
    if ($statusCode === 206) { header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size); }
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-Content-Type-Options: nosniff');

    $handle = fopen($path, 'rb');
    if (!$handle) { dp_download_error('file_missing', 'Download unavailable', 'The product file is currently unavailable.', 404); }
    if ($start > 0) { fseek($handle, $start); }
    $remaining = $length;
    $chunk = 1024 * 1024;
    while ($remaining > 0 && !feof($handle)) {
        $read = min($chunk, $remaining);
        echo fread($handle, $read);
        $remaining -= $read;
        flush();
    }
    fclose($handle);
    exit;
} catch (\Throwable $e) {
    if (function_exists('logActivity')) { logActivity('DigitalProducts download error: ' . $e->getMessage()); }
    dp_download_error('error', 'Download unavailable', 'This download is currently unavailable. Please return to My Downloads or contact support.', 500);
}
