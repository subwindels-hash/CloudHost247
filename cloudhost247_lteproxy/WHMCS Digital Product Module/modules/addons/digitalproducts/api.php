<?php
/**
 * DigitalProducts API Endpoint
 *
 * REST-style API for external integrations, mobile apps, etc.
 * All responses are JSON.
 *
 * @package    DigitalProducts
 * @version    1.0.0
 */

require_once __DIR__ . '/../../../init.php';
require_once __DIR__ . '/lib/Core.php';
require_once __DIR__ . '/lib/License.php';

use DigitalProducts\Core;
use DigitalProducts\License;
use WHMCS\Database\Capsule;

// Set JSON headers
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');

$core = new Core();
$licenseManager = new License();

// API Authentication
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$apiToken = '';

if (preg_match('/Bearer\s+(.+)/i', $authHeader, $matches)) {
    $apiToken = $matches[1];
}

// Allow token via query parameter for development (not recommended for production)
if (empty($apiToken) && isset($_GET['api_token'])) {
    $apiToken = $_GET['api_token'];
}

// Validate token
$clientId = 0;
if (!empty($apiToken)) {
    $tokenRecord = Capsule::table('mod_digitalproducts_api_tokens')
        ->where('api_token', $apiToken)
        ->where(function($q) {
            $q->whereNull('expires_at')->orWhere('expires_at', '>', date('Y-m-d H:i:s'));
        })
        ->first();

    if ($tokenRecord) {
        $clientId = $tokenRecord->client_id;
        // Update last used
        Capsule::table('mod_digitalproducts_api_tokens')
            ->where('id', $tokenRecord->id)
            ->update(['last_used_at' => date('Y-m-d H:i:s')]);
    }
}

// Also allow session-based auth for web clients
if (!$clientId && isset($_SESSION['uid'])) {
    $clientId = (int)$_SESSION['uid'];
}

$action = $_GET['endpoint'] ?? '';
$response = ['status' => 'error', 'message' => 'Unknown endpoint'];

switch ($action) {
    case 'products':
        // List available digital products (public)
        $products = Capsule::table('mod_digitalproducts_products')
            ->where('status', 'active')
            ->whereNotNull('current_file_id')
            ->select('id', 'product_name', 'description', 'current_file_id', 'created_at', 'updated_at')
            ->get();
        $response = ['status' => 'success', 'data' => $products];
        break;

    case 'my-downloads':
        // List client's downloads (auth required)
        if (!$clientId) {
            http_response_code(401);
            $response = ['status' => 'error', 'message' => 'Authentication required'];
            break;
        }

        $downloads = $core->getClientDownloads($clientId);
        $result = [];
        foreach ($downloads as $d) {
            $downloadCount = $core->getDownloadCount($clientId, $d->service_id, $d->file_id);
            $downloadLimit = (int)($d->download_limit ?? 0);

            $result[] = [
                'service_id' => $d->service_id,
                'product_name' => $d->product_name,
                'version' => $d->version,
                'file_id' => $d->file_id,
                'license_key' => $d->license_key,
                'license_status' => $d->license_status,
                'purchase_date' => $d->purchase_date,
                'next_due_date' => $d->nextduedate,
                'download_count' => $downloadCount,
                'download_limit' => $downloadLimit,
                'can_download' => $downloadLimit === 0 || $downloadCount < $downloadLimit,
            ];
        }
        $response = ['status' => 'success', 'data' => $result];
        break;

    case 'download-link':
        // Generate secure download link (auth required)
        if (!$clientId) {
            http_response_code(401);
            $response = ['status' => 'error', 'message' => 'Authentication required'];
            break;
        }

        $reqServiceId = (int)($_POST['service_id'] ?? 0);
        $reqFileId = (int)($_POST['file_id'] ?? 0);

        if (!$reqServiceId || !$reqFileId) {
            $response = ['status' => 'error', 'message' => 'service_id and file_id required'];
            break;
        }

        if (!$core->validateServiceOwnership($reqServiceId, $clientId)) {
            http_response_code(403);
            $response = ['status' => 'error', 'message' => 'Access denied'];
            break;
        }

        $token = $core->generateToken($reqServiceId, $reqFileId, $clientId);
        $systemUrl = Capsule::table('tblconfiguration')
            ->where('setting', 'SystemURL')
            ->value('value');

        $downloadUrl = rtrim($systemUrl, '/') . '/modules/addons/digitalproducts/download.php?token=' . $token;

        $response = [
            'status' => 'success',
            'data' => [
                'download_url' => $downloadUrl,
                'token' => $token,
                'expires_at' => date('Y-m-d H:i:s', strtotime('+48 hours')),
            ]
        ];
        break;

    case 'validate-license':
        // Validate a license key (public endpoint)
        $licenseKey = $_POST['license_key'] ?? '';
        $domain = $_POST['domain'] ?? null;

        if (empty($licenseKey)) {
            $response = ['status' => 'error', 'message' => 'license_key required'];
            break;
        }

        $result = $licenseManager->validateLicense($licenseKey, $domain);
        if ($result['valid']) {
            $response = [
                'status' => 'success',
                'data' => [
                    'valid' => true,
                    'product_name' => $result['license']->product_name ?? null,
                    'status' => $result['license']->status,
                    'expires_at' => $result['license']->expires_at,
                ]
            ];
        } else {
            $response = ['status' => 'error', 'message' => $result['error']];
        }
        break;

    case 'activate-license':
        // Activate license on a domain
        $licenseKey = $_POST['license_key'] ?? '';
        $domain = $_POST['domain'] ?? ($_SERVER['HTTP_HOST'] ?? '');

        if (empty($licenseKey) || empty($domain)) {
            $response = ['status' => 'error', 'message' => 'license_key and domain required'];
            break;
        }

        $result = $licenseManager->activateLicense($licenseKey, $domain);
        if ($result['success']) {
            $response = ['status' => 'success', 'message' => 'License activated successfully'];
        } else {
            $response = ['status' => 'error', 'message' => $result['error']];
        }
        break;

    case 'my-licenses':
        // List client licenses (auth required)
        if (!$clientId) {
            http_response_code(401);
            $response = ['status' => 'error', 'message' => 'Authentication required'];
            break;
        }

        $licenses = $licenseManager->getClientLicenses($clientId);
        $response = ['status' => 'success', 'data' => $licenses];
        break;

    default:
        $response = [
            'status' => 'error',
            'message' => 'Unknown endpoint. Available: products, my-downloads, download-link, validate-license, activate-license, my-licenses'
        ];
        break;
}

echo json_encode($response, JSON_PRETTY_PRINT);
exit;
