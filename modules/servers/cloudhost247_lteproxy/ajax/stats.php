<?php

declare(strict_types=1);

/**
 * CloudHost247 LTE Proxy Statistics AJAX Handler
 *
 * Handles statistics and data retrieval for the dashboard.
 *
 * @package CloudHost247\LTEProxy\AJAX
 * @version 1.0.0
 */

require_once __DIR__ . '/../../../init.php';
require_once __DIR__ . '/../lib/ApiException.php';
require_once __DIR__ . '/../lib/Logger.php';
require_once __DIR__ . '/../lib/Cache.php';
require_once __DIR__ . '/../lib/Helpers.php';
require_once __DIR__ . '/../lib/RateLimiter.php';
require_once __DIR__ . '/../lib/ApiClient.php';

use CloudHost247\LTEProxy\ApiClient;
use CloudHost247\LTEProxy\Helpers;
use CloudHost247\LTEProxy\Logger;

if (!isset($_SESSION['uid'])) {
    Helpers::jsonError('Unauthorized', 401);
}

$csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_GET['csrf_token'] ?? '';
if (!Helpers::validateCsrfToken($csrfToken)) {
    Helpers::jsonError('Invalid token', 403);
}

$action = $_GET['action'] ?? '';
$serviceId = (int) ($_GET['service_id'] ?? 0);

if (empty($serviceId)) {
    Helpers::jsonError('Service ID required', 400);
}

$service = Capsule::table('tblhosting')
    ->where('id', $serviceId)
    ->where('userid', $_SESSION['uid'])
    ->first();

if (!$service) {
    Helpers::jsonError('Service not found', 404);
}

$product = Capsule::table('tblproducts')
    ->where('id', $service->packageid)
    ->first();

if (!$product || $product->servertype !== 'cloudhost247_lteproxy') {
    Helpers::jsonError('Invalid service', 400);
}

$params = [
    'configoption1' => $product->configoption1 ?? '',
    'configoption2' => $product->configoption2 ?? '',
    'configoption3' => $product->configoption3 ?? 'https://api.cloudhost247.com',
    'configoption4' => $product->configoption4 ?? 30,
    'configoption15' => $product->configoption15 ?? 'on',
    'configoption16' => $product->configoption16 ?? 'INFO',
    'configoption17' => $product->configoption17 ?? 'on',
    'configoption18' => $product->configoption18 ?? 60,
];

$config = [
    'api_key' => $params['configoption1'] ?? '',
    'api_secret' => $params['configoption2'] ?? '',
    'api_base_url' => $params['configoption3'] ?? 'https://api.cloudhost247.com',
    'api_timeout' => (int) ($params['configoption4'] ?? 30),
    'logging_enabled' => (bool) ($params['configoption15'] ?? true),
    'log_level' => $params['configoption16'] ?? 'INFO',
    'cache_enabled' => (bool) ($params['configoption17'] ?? true),
    'rate_limit_requests' => (int) ($params['configoption18'] ?? 60),
    'log_directory' => __DIR__ . '/../logs',
    'cache_directory' => __DIR__ . '/../cache',
];

$logger = new Logger($config);

try {
    $api = new ApiClient($config, $logger);
    $orderId = $service->username ?? '';

    switch ($action) {
        case 'get_usage_stats':
            getUsageStats($api, $orderId);
            break;

        case 'get_order_history':
            getOrderHistory($api, $orderId);
            break;

        case 'get_rotation_status':
            getRotationStatus($api, $orderId);
            break;

        case 'get_account_summary':
            getAccountSummary($api);
            break;

        default:
            Helpers::jsonError('Unknown action', 400);
    }
} catch (\Exception $e) {
    $logger->logException($e, 'Stats: ' . $action);
    Helpers::jsonError('Failed to load statistics', 500);
}

function getUsageStats(ApiClient $api, string $orderId): void
{
    if (empty($orderId)) {
        Helpers::jsonSuccess(['stats' => null]);
    }

    $proxies = $api->getOrderProxies($orderId);
    $proxyList = $proxies['data'] ?? [];

    $totalRequests = 0;
    $totalBandwidth = 0;
    $activeProxies = 0;
    $regionCounts = [];
    $carrierCounts = [];

    foreach ($proxyList as $proxy) {
        if (($proxy['status'] ?? '') === 'active') {
            $activeProxies++;
        }

        $totalRequests += $proxy['request_count'] ?? 0;
        $totalBandwidth += $proxy['bandwidth_used'] ?? 0;

        $region = $proxy['region'] ?? 'unknown';
        $regionCounts[$region] = ($regionCounts[$region] ?? 0) + 1;

        $carrier = $proxy['carrier'] ?? 'unknown';
        $carrierCounts[$carrier] = ($carrierCounts[$carrier] ?? 0) + 1;
    }

    Helpers::jsonSuccess([
        'stats' => [
            'total_proxies' => count($proxyList),
            'active_proxies' => $activeProxies,
            'inactive_proxies' => count($proxyList) - $activeProxies,
            'total_requests' => number_format($totalRequests),
            'total_bandwidth' => Helpers::formatBytes($totalBandwidth),
            'region_distribution' => $regionCounts,
            'carrier_distribution' => $carrierCounts,
        ],
    ]);
}

function getOrderHistory(ApiClient $api, string $orderId): void
{
    if (empty($orderId)) {
        Helpers::jsonSuccess(['history' => []]);
    }

    $activeOrders = $api->getOrders(['order_id' => $orderId]);
    $expiredOrders = $api->getExpiredOrders(['order_id' => $orderId]);

    $history = [];

    foreach ($activeOrders['data'] ?? [] as $order) {
        $history[] = [
            'id' => $order['id'] ?? '',
            'status' => $order['status'] ?? 'unknown',
            'type' => 'active',
            'quantity' => $order['quantity'] ?? 0,
            'region' => $order['region'] ?? '',
            'carrier' => $order['carrier'] ?? '',
            'created_at' => Helpers::formatDate($order['created_at'] ?? ''),
            'expires_at' => Helpers::formatDate($order['expires_at'] ?? ''),
        ];
    }

    foreach ($expiredOrders['data'] ?? [] as $order) {
        $history[] = [
            'id' => $order['id'] ?? '',
            'status' => 'expired',
            'type' => 'expired',
            'quantity' => $order['quantity'] ?? 0,
            'region' => $order['region'] ?? '',
            'carrier' => $order['carrier'] ?? '',
            'created_at' => Helpers::formatDate($order['created_at'] ?? ''),
            'expires_at' => Helpers::formatDate($order['expires_at'] ?? ''),
        ];
    }

    // Sort by created date descending
    usort($history, function ($a, $b) {
        return strtotime($b['created_at'] ?? '0') <=> strtotime($a['created_at'] ?? '0');
    });

    Helpers::jsonSuccess(['history' => $history]);
}

function getRotationStatus(ApiClient $api, string $orderId): void
{
    if (empty($orderId)) {
        Helpers::jsonSuccess(['rotations' => []]);
    }

    $proxies = $api->getOrderProxies($orderId);
    $proxyList = $proxies['data'] ?? [];

    $rotations = [];

    foreach ($proxyList as $proxy) {
        $rotations[] = [
            'proxy_id' => $proxy['id'] ?? '',
            'ip' => $proxy['ip'] ?? '',
            'rotation_type' => $proxy['rotation_type'] ?? 'manual',
            'rotation_interval' => $proxy['rotation_interval'] ?? 60,
            'last_rotated' => $proxy['last_rotated'] ?? '',
            'next_rotation' => $proxy['next_rotation'] ?? '',
            'time_until_next' => !empty($proxy['next_rotation'])
                ? max(0, (int) floor((strtotime($proxy['next_rotation']) - time()) / 60))
                : 0,
        ];
    }

    Helpers::jsonSuccess(['rotations' => $rotations]);
}

function getAccountSummary(ApiClient $api): void
{
    try {
        $account = $api->getAccountInfo();
        $balance = $api->getBalance();

        Helpers::jsonSuccess([
            'account' => [
                'status' => $account['data']['status'] ?? 'unknown',
                'api_version' => $account['data']['api_version'] ?? '1.0',
                'rate_limit' => $account['data']['rate_limit'] ?? 60,
            ],
            'balance' => [
                'amount' => $balance['data']['balance'] ?? 0,
                'currency' => $balance['data']['currency'] ?? 'USD',
                'formatted' => '$' . number_format($balance['data']['balance'] ?? 0, 2),
            ],
        ]);
    } catch (\Exception $e) {
        Helpers::jsonSuccess([
            'account' => ['status' => 'unknown'],
            'balance' => ['amount' => 0, 'formatted' => '$0.00'],
        ]);
    }
}
