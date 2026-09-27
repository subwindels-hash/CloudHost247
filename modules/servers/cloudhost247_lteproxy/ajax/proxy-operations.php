<?php

declare(strict_types=1);

/**
 * CloudHost247 LTE Proxy Operations AJAX Handler
 *
 * Handles proxy CRUD operations via AJAX requests.
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
use CloudHost247\LTEProxy\ApiException;
use CloudHost247\LTEProxy\Helpers;
use CloudHost247\LTEProxy\Logger;

// Security checks
if (!isset($_SESSION['uid'])) {
    Helpers::jsonError('Unauthorized access', 401);
}

// Validate CSRF token
$csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['csrf_token'] ?? '';
if (!Helpers::validateCsrfToken($csrfToken)) {
    Helpers::jsonError('Invalid security token. Please refresh the page.', 403);
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';
$serviceId = (int) ($_POST['service_id'] ?? $_GET['service_id'] ?? 0);

if (empty($serviceId)) {
    Helpers::jsonError('Service ID is required', 400);
}

// Verify service ownership
$service = Capsule::table('tblhosting')
    ->where('id', $serviceId)
    ->where('userid', $_SESSION['uid'])
    ->first();

if (!$service) {
    Helpers::jsonError('Service not found or access denied', 404);
}

// Get product configuration
$product = Capsule::table('tblproducts')
    ->where('id', $service->packageid)
    ->first();

if (!$product || $product->servertype !== 'cloudhost247_lteproxy') {
    Helpers::jsonError('Invalid service type', 400);
}

// Build module params
$params = buildModuleParams($service, $product);
$logger = new Logger(getCh247Config($params));

try {
    $api = new ApiClient(getCh247Config($params), $logger);
    $orderId = $service->username ?? '';

    switch ($action) {
        case 'get_proxies':
            handleGetProxies($api, $orderId, $logger);
            break;

        case 'get_order_details':
            handleGetOrderDetails($api, $orderId, $logger);
            break;

        case 'update_client_ip':
            handleUpdateClientIp($api, $logger);
            break;

        case 'update_region':
            handleUpdateRegion($api, $logger);
            break;

        case 'update_carrier':
            handleUpdateCarrier($api, $logger);
            break;

        case 'update_proxy_type':
            handleUpdateProxyType($api, $logger);
            break;

        case 'update_auth':
            handleUpdateAuth($api, $logger);
            break;

        case 'update_rotation':
            handleUpdateRotation($api, $logger);
            break;

        case 'rotate_ip':
            handleRotateIp($api, $logger);
            break;

        case 'reveal_ip':
            handleRevealIp($api, $logger);
            break;

        case 'extend_order':
            handleExtendOrder($api, $orderId, $logger);
            break;

        case 'cancel_order':
            handleCancelOrder($api, $orderId, $logger);
            break;

        case 'get_balance':
            handleGetBalance($api, $logger);
            break;

        case 'get_available_proxies':
            handleGetAvailableProxies($api, $logger);
            break;

        case 'request_trial':
            handleRequestTrial($api, $params, $logger);
            break;

        default:
            Helpers::jsonError('Unknown action: ' . Helpers::sanitizeString($action), 400);
    }
} catch (ApiException $e) {
    $logger->logException($e, 'AJAX: ' . $action);
    Helpers::jsonError($e->getUserMessage(), $e->getCode(), [
        'error_code' => $e->getErrorCode(),
        'is_retryable' => $e->isRetryable(),
    ]);
} catch (\Exception $e) {
    $logger->logException($e, 'AJAX: ' . $action);
    Helpers::jsonError('An unexpected error occurred. Please try again.', 500);
}

/**
 * Handle get proxies request
 */
function handleGetProxies(ApiClient $api, string $orderId, Logger $logger): void
{
    if (empty($orderId)) {
        Helpers::jsonSuccess(['proxies' => [], 'count' => 0]);
    }

    $response = $api->getOrderProxies($orderId);
    $proxies = $response['data'] ?? [];

    // Format proxies for display
    $formatted = [];
    foreach ($proxies as $proxy) {
        $formatted[] = [
            'id' => $proxy['id'] ?? '',
            'ip' => $proxy['ip'] ?? $proxy['host'] ?? '',
            'port' => $proxy['port'] ?? '',
            'type' => strtoupper($proxy['proxy_type'] ?? 'SOCKS5'),
            'region' => $proxy['region'] ?? '',
            'carrier' => $proxy['carrier'] ?? '',
            'status' => $proxy['status'] ?? 'unknown',
            'connection_type' => $proxy['connection_type'] ?? 'WIFI_AND_CELLULAR',
            'username' => $proxy['username'] ?? '',
            'password' => Helpers::maskString($proxy['password'] ?? '', 3),
            'full_password' => $proxy['password'] ?? '',
            'auth_type' => $proxy['auth_type'] ?? 'username_password',
            'client_ip' => $proxy['client_ip'] ?? '',
            'rotation_type' => $proxy['rotation_type'] ?? 'manual',
            'rotation_interval' => $proxy['rotation_interval'] ?? 60,
            'last_rotated' => $proxy['last_rotated'] ?? '',
            'expires_at' => $proxy['expires_at'] ?? '',
            'formatted_proxy' => Helpers::formatProxy($proxy),
            'copy_format' => Helpers::formatProxyForCopy($proxy),
            'is_1by1' => (bool) ($proxy['is_1by1'] ?? false),
            'time_remaining' => Helpers::getTimeRemaining($proxy['expires_at'] ?? ''),
        ];
    }

    Helpers::jsonSuccess([
        'proxies' => $formatted,
        'count' => count($formatted),
    ]);
}

/**
 * Handle get order details request
 */
function handleGetOrderDetails(ApiClient $api, string $orderId, Logger $logger): void
{
    if (empty($orderId)) {
        Helpers::jsonSuccess(['order' => null]);
    }

    $response = $api->getOrders(['order_id' => $orderId]);
    $order = $response['data'][0] ?? [];

    Helpers::jsonSuccess([
        'order' => [
            'id' => $order['id'] ?? $orderId,
            'status' => $order['status'] ?? 'unknown',
            'quantity' => $order['quantity'] ?? 0,
            'region' => $order['region'] ?? '',
            'carrier' => $order['carrier'] ?? '',
            'proxy_type' => $order['proxy_type'] ?? '',
            'created_at' => Helpers::formatDate($order['created_at'] ?? ''),
            'expires_at' => Helpers::formatDate($order['expires_at'] ?? ''),
            'time_remaining' => Helpers::getTimeRemaining($order['expires_at'] ?? ''),
            'connection_type' => $order['connection_type'] ?? '',
            'rotation_type' => $order['rotation_type'] ?? '',
        ],
    ]);
}

/**
 * Handle update client IP request
 */
function handleUpdateClientIp(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';
    $clientIp = $_POST['client_ip'] ?? '';

    if (empty($proxyId) || empty($clientIp)) {
        Helpers::jsonError('Proxy ID and client IP are required', 400);
    }

    if (!Helpers::isValidIp($clientIp)) {
        Helpers::jsonError('Invalid IP address format', 400);
    }

    $response = $api->updateClientIp($proxyId, $clientIp);
    $logger->info('Updated client IP', ['proxy_id' => $proxyId, 'ip' => $clientIp]);

    Helpers::jsonSuccess([
        'message' => 'Client IP updated successfully',
        'ip' => $clientIp,
    ]);
}

/**
 * Handle update region request
 */
function handleUpdateRegion(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';
    $region = $_POST['region'] ?? '';

    if (empty($proxyId) || empty($region)) {
        Helpers::jsonError('Proxy ID and region are required', 400);
    }

    if (!Helpers::isValidRegion($region)) {
        Helpers::jsonError('Invalid region selected', 400);
    }

    $response = $api->updateRegion($proxyId, $region);
    $logger->info('Updated proxy region', ['proxy_id' => $proxyId, 'region' => $region]);

    Helpers::jsonSuccess([
        'message' => 'Region updated to ' . Helpers::getRegions()[$region] ?? $region,
        'region' => $region,
    ]);
}

/**
 * Handle update carrier request
 */
function handleUpdateCarrier(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';
    $carrier = $_POST['carrier'] ?? '';

    if (empty($proxyId) || empty($carrier)) {
        Helpers::jsonError('Proxy ID and carrier are required', 400);
    }

    if (!Helpers::isValidCarrier($carrier)) {
        Helpers::jsonError('Invalid carrier selected', 400);
    }

    $response = $api->updateCarrier($proxyId, $carrier);
    $logger->info('Updated proxy carrier', ['proxy_id' => $proxyId, 'carrier' => $carrier]);

    Helpers::jsonSuccess([
        'message' => 'Carrier updated successfully',
        'carrier' => $carrier,
    ]);
}

/**
 * Handle update proxy type request
 */
function handleUpdateProxyType(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';
    $proxyType = $_POST['proxy_type'] ?? '';

    if (empty($proxyId) || empty($proxyType)) {
        Helpers::jsonError('Proxy ID and type are required', 400);
    }

    $response = $api->updateProxyType($proxyId, $proxyType);
    $logger->info('Updated proxy type', ['proxy_id' => $proxyId, 'type' => $proxyType]);

    Helpers::jsonSuccess([
        'message' => 'Proxy type updated to ' . strtoupper($proxyType),
        'type' => strtoupper($proxyType),
    ]);
}

/**
 * Handle update auth request
 */
function handleUpdateAuth(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';
    $authType = $_POST['auth_type'] ?? '';

    if (empty($proxyId) || empty($authType)) {
        Helpers::jsonError('Proxy ID and auth type are required', 400);
    }

    $authParams = ['auth_type' => $authType];

    if (in_array($authType, ['username_password', 'both'], true)) {
        $password = $_POST['password'] ?? '';
        if (!empty($password)) {
            $authParams['password'] = $password;
        }
    }

    if (in_array($authType, ['ip_whitelist', 'both'], true)) {
        $clientIp = $_POST['client_ip'] ?? Helpers::getClientIp();
        $authParams['client_ip'] = $clientIp;
    }

    $response = $api->updateProxyAuth($proxyId, $authParams);
    $logger->info('Updated proxy auth', ['proxy_id' => $proxyId, 'auth_type' => $authType]);

    Helpers::jsonSuccess([
        'message' => 'Authentication updated successfully',
        'auth_type' => $authType,
    ]);
}

/**
 * Handle update rotation request
 */
function handleUpdateRotation(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';
    $rotationType = $_POST['rotation_type'] ?? '';
    $rotationInterval = (int) ($_POST['rotation_interval'] ?? 60);

    if (empty($proxyId) || empty($rotationType)) {
        Helpers::jsonError('Proxy ID and rotation type are required', 400);
    }

    $rotationParams = [
        'rotation_type' => $rotationType,
        'rotation_interval' => max(1, min(1440, $rotationInterval)),
    ];

    $response = $api->updateProxyRotation($proxyId, $rotationParams);
    $logger->info('Updated proxy rotation', ['proxy_id' => $proxyId, 'type' => $rotationType]);

    Helpers::jsonSuccess([
        'message' => 'Rotation settings updated',
        'rotation_type' => $rotationType,
        'interval' => $rotationParams['rotation_interval'],
    ]);
}

/**
 * Handle rotate IP request
 */
function handleRotateIp(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';

    if (empty($proxyId)) {
        Helpers::jsonError('Proxy ID is required', 400);
    }

    $response = $api->rotateProxyIp($proxyId);
    $newIp = $response['data']['new_ip'] ?? '';

    $logger->info('Rotated proxy IP', ['proxy_id' => $proxyId, 'new_ip' => $newIp]);

    Helpers::jsonSuccess([
        'message' => 'IP rotated successfully',
        'new_ip' => $newIp,
        'timestamp' => date('c'),
    ]);
}

/**
 * Handle reveal IP request (for 1:1 proxies)
 */
function handleRevealIp(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';

    if (empty($proxyId)) {
        Helpers::jsonError('Proxy ID is required', 400);
    }

    $response = $api->reveal1By1ProxyIp($proxyId);
    $revealedIp = $response['data']['ip'] ?? '';

    $logger->info('Revealed 1:1 proxy IP', ['proxy_id' => $proxyId, 'ip' => $revealedIp]);

    Helpers::jsonSuccess([
        'message' => 'IP revealed successfully',
        'ip' => $revealedIp,
    ]);
}

/**
 * Handle extend order request
 */
function handleExtendOrder(ApiClient $api, string $orderId, Logger $logger): void
{
    if (empty($orderId)) {
        Helpers::jsonError('No active order found', 400);
    }

    $duration = (int) ($_POST['duration'] ?? 30);
    $duration = max(1, min(365, $duration));

    $response = $api->extendOrder($orderId, $duration);
    $logger->info('Extended order', ['order_id' => $orderId, 'duration' => $duration]);

    Helpers::jsonSuccess([
        'message' => 'Order extended by ' . Helpers::formatDuration($duration),
        'duration' => $duration,
        'new_expiry' => $response['data']['new_expires_at'] ?? '',
    ]);
}

/**
 * Handle cancel order request
 */
function handleCancelOrder(ApiClient $api, string $orderId, Logger $logger): void
{
    if (empty($orderId)) {
        Helpers::jsonError('No active order found', 400);
    }

    $reason = $_POST['reason'] ?? 'Cancelled by client';
    $response = $api->cancelOrder($orderId, $reason);

    $logger->info('Cancelled order', ['order_id' => $orderId, 'reason' => $reason]);

    Helpers::jsonSuccess([
        'message' => 'Order cancelled successfully',
    ]);
}

/**
 * Handle get balance request
 */
function handleGetBalance(ApiClient $api, Logger $logger): void
{
    $response = $api->getBalance();

    Helpers::jsonSuccess([
        'balance' => $response['data']['balance'] ?? 0,
        'currency' => $response['data']['currency'] ?? 'USD',
        'formatted_balance' => '$' . number_format($response['data']['balance'] ?? 0, 2),
    ]);
}

/**
 * Handle get available proxies request
 */
function handleGetAvailableProxies(ApiClient $api, Logger $logger): void
{
    $type = $_GET['type'] ?? 'us';

    $response = match ($type) {
        '1by1' => $api->getAvailable1By1Proxies(),
        'us' => $api->getAvailableUsProxies(),
        'non_us' => $api->getAvailableNonUsProxies(),
        'us_carrier' => $api->getAvailableUsCarrierProxies($_GET['carrier'] ?? null),
        default => $api->getAvailableUsProxies(),
    };

    Helpers::jsonSuccess([
        'proxies' => $response['data'] ?? [],
        'type' => $type,
    ]);
}

/**
 * Handle request trial request
 */
function handleRequestTrial(ApiClient $api, array $params, Logger $logger): void
{
    $trialEnabled = (bool) ($params['configoption12'] ?? false);

    if (!$trialEnabled) {
        Helpers::jsonError('Trial proxies are not enabled for this product', 403);
    }

    $trialParams = [
        'client_id' => $_SESSION['uid'],
        'region' => $_POST['region'] ?? 'us',
        'carrier' => $_POST['carrier'] ?? 'verizon',
        'proxy_type' => $_POST['proxy_type'] ?? 'SOCKS5',
    ];

    $response = $api->addTrial($trialParams);
    $logger->info('Trial proxy requested', ['client_id' => $_SESSION['uid']]);

    Helpers::jsonSuccess([
        'message' => 'Trial proxy activated',
        'trial_id' => $response['data']['trial_id'] ?? '',
        'expires_at' => $response['data']['expires_at'] ?? '',
    ]);
}

/**
 * Build module parameters from database records
 */
function buildModuleParams($service, $product): array
{
    return [
        'serviceid' => $service->id,
        'username' => $service->username ?? '',
        'password' => $service->password ?? '',
        'configoption1' => $product->configoption1 ?? '',
        'configoption2' => $product->configoption2 ?? '',
        'configoption3' => $product->configoption3 ?? 'https://api.cloudhost247.com',
        'configoption4' => $product->configoption4 ?? 30,
        'configoption5' => $product->configoption5 ?? 'SOCKS5',
        'configoption6' => $product->configoption6 ?? 'WIFI_AND_CELLULAR',
        'configoption7' => $product->configoption7 ?? 'manual',
        'configoption8' => $product->configoption8 ?? 60,
        'configoption9' => $product->configoption9 ?? 'us',
        'configoption10' => $product->configoption10 ?? 'verizon',
        'configoption11' => $product->configoption11 ?? 'username_password',
        'configoption12' => $product->configoption12 ?? '',
        'configoption13' => $product->configoption13 ?? 24,
        'configoption14' => $product->configoption14 ?? 'on',
        'configoption15' => $product->configoption15 ?? 'on',
        'configoption16' => $product->configoption16 ?? 'INFO',
        'configoption17' => $product->configoption17 ?? 'on',
        'configoption18' => $product->configoption18 ?? 60,
    ];
}

/**
 * Get module configuration
 */
function getCh247Config(array $params): array
{
    return [
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
}
