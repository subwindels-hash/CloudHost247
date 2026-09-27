<?php
/**
 * DigitalProducts Secure Download Handler
 *
 * Handles all file downloads with validation, token checks,
 * download limits and logging.
 *
 * @package    DigitalProducts
 * @version    1.0.0
 */

// Bootstrap WHMCS
require_once __DIR__ . '/../../../init.php';
require_once __DIR__ . '/lib/Core.php';
require_once __DIR__ . '/lib/License.php';

use DigitalProducts\Core;
use DigitalProducts\License;
use WHMCS\Database\Capsule;
use WHMCS\Authentication\CurrentUser;

// Prevent any output before file download
ob_start();

$core = new Core();
$licenseManager = new License();

// Get parameters
$token = $_GET['token'] ?? '';
$serviceId = (int)($_POST['service_id'] ?? 0);
$fileId = (int)($_POST['file_id'] ?? 0);

$authenticated = false;
$clientId = 0;

// Check authentication
if (class_exists('WHMCS\Authentication\CurrentUser')) {
    $currentUser = new CurrentUser();
    if ($currentUser->isAuthenticatedUser()) {
        $authenticated = true;
        $clientId = $currentUser->user()->id;
    }
}

// Fallback to session check
if (!$authenticated && isset($_SESSION['uid'])) {
    $clientId = (int)$_SESSION['uid'];
    $authenticated = $clientId > 0;
}

// If not authenticated and no token, redirect to login
if (!$authenticated && empty($token)) {
    ob_end_clean();
    header('Location: ' . $WHMCS_CONFIG['SystemURL'] . '/clientarea.php');
    exit;
}

// Determine download parameters
$downloadServiceId = 0;
$downloadFileId = 0;
$downloadClientId = $clientId;

if (!empty($token)) {
    // Validate token
    $tokenData = $core->validateToken($token);
    if (!$tokenData) {
        ob_end_clean();
        header('HTTP/1.1 403 Forbidden');
        echo '<h1>Download Link Expired</h1><p>This download link has expired or is invalid. Please access your downloads from the client area.</p>';
        exit;
    }
    $downloadServiceId = $tokenData['service_id'];
    $downloadFileId = $tokenData['file_id'];
    $downloadClientId = $tokenData['client_id'];
} else {
    $downloadServiceId = $serviceId;
    $downloadFileId = $fileId;
}

// Validate parameters
if (!$downloadServiceId || !$downloadFileId) {
    ob_end_clean();
    header('HTTP/1.1 400 Bad Request');
    echo '<h1>Invalid Request</h1><p>Missing required parameters.</p>';
    exit;
}

// Validate service ownership
if ($authenticated && $clientId) {
    $downloadClientId = $clientId;
}

if (!$core->validateServiceOwnership($downloadServiceId, $downloadClientId)) {
    // Log failed attempt
    $core->logDownload([
        'file_id' => $downloadFileId,
        'product_id' => 0,
        'service_id' => $downloadServiceId,
        'client_id' => $downloadClientId,
        'status' => 'failed',
        'download_token' => $token,
    ]);
    ob_end_clean();
    header('HTTP/1.1 403 Forbidden');
    echo '<h1>Access Denied</h1><p>You do not have permission to download this file.</p>';
    exit;
}

// Get file info
$file = $core->getFileById($downloadFileId);
if (!$file || !file_exists($file->file_path)) {
    ob_end_clean();
    header('HTTP/1.1 404 Not Found');
    echo '<h1>File Not Found</h1><p>The requested file could not be found.</p>';
    exit;
}

// Get product info for download limits
$service = Capsule::table('tblhosting')
    ->join('mod_digitalproducts_products', 'mod_digitalproducts_products.product_id', '=', 'tblhosting.packageid')
    ->where('tblhosting.id', $downloadServiceId)
    ->select('mod_digitalproducts_products.*')
    ->first();

// Check download limits
if ($service) {
    $downloadLimit = (int)($service->download_limit ?? 0);
    if ($downloadLimit > 0) {
        $currentCount = $core->getDownloadCount($downloadClientId, $downloadServiceId, $downloadFileId);
        if ($currentCount >= $downloadLimit) {
            $core->logDownload([
                'file_id' => $downloadFileId,
                'product_id' => $service->id,
                'service_id' => $downloadServiceId,
                'client_id' => $downloadClientId,
                'status' => 'limit',
                'download_token' => $token,
            ]);
            ob_end_clean();
            header('HTTP/1.1 403 Forbidden');
            echo '<h1>Download Limit Reached</h1><p>You have reached the maximum number of downloads for this product. Please contact support.</p>';
            exit;
        }
    }
}

// Log successful download
$core->logDownload([
    'file_id' => $downloadFileId,
    'product_id' => $service->id ?? 0,
    'service_id' => $downloadServiceId,
    'client_id' => $downloadClientId,
    'status' => 'success',
    'download_token' => $token,
]);

// Increment file download count
$core->incrementFileDownloadCount($downloadFileId);

// Clear output buffer and serve file
ob_end_clean();

// Set headers for download
$filename = $file->original_name;
$fileSize = $file->file_size;
$contentType = 'application/octet-stream';

// Detect content type by extension
$ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
$contentTypes = [
    'zip' => 'application/zip',
    'tar' => 'application/x-tar',
    'gz' => 'application/gzip',
    'bz2' => 'application/x-bzip2',
    '7z' => 'application/x-7z-compressed',
    'rar' => 'application/x-rar-compressed',
    'php' => 'application/x-php',
    'js' => 'application/javascript',
    'json' => 'application/json',
    'xml' => 'application/xml',
    'txt' => 'text/plain',
    'md' => 'text/markdown',
    'pdf' => 'application/pdf',
    'doc' => 'application/msword',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

if (isset($contentTypes[$ext])) {
    $contentType = $contentTypes[$ext];
}

// Disable caching
header('Cache-Control: no-cache, must-revalidate');
header('Expires: Mon, 26 Jul 1997 05:00:00 GMT');
header('Content-Type: ' . $contentType);
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Content-Length: ' . $fileSize);
header('Content-Transfer-Encoding: binary');

// For large files, read and output in chunks
$chunkSize = 1024 * 1024; // 1MB chunks
$handle = fopen($file->file_path, 'rb');
if ($handle) {
    while (!feof($handle)) {
        echo fread($handle, $chunkSize);
        flush();
    }
    fclose($handle);
} else {
    readfile($file->file_path);
}

exit;
