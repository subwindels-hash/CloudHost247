<?php

declare(strict_types=1);

/**
 * CloudHost247 LTE Proxy Testing AJAX Handler
 *
 * Handles proxy alive and speed test operations.
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

$csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['csrf_token'] ?? '';
if (!Helpers::validateCsrfToken($csrfToken)) {
    Helpers::jsonError('Invalid security token', 403);
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';
$serviceId = (int) ($_POST['service_id'] ?? $_GET['service_id'] ?? 0);

if (empty($serviceId)) {
    Helpers::jsonError('Service ID is required', 400);
}

// Verify ownership
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
    Helpers::jsonError('Invalid service type', 400);
}

$params = buildTestModuleParams($service, $product);
$logger = new Logger(getTestConfig($params));

try {
    $api = new ApiClient(getTestConfig($params), $logger);

    switch ($action) {
        case 'test_alive':
            handleTestAlive($api, $logger);
            break;

        case 'test_speed':
            handleTestSpeed($api, $logger);
            break;

        case 'batch_test':
            handleBatchTest($api, $service->username ?? '', $logger);
            break;

        default:
            Helpers::jsonError('Unknown test action', 400);
    }
} catch (ApiException $e) {
    $logger->logException($e, 'ProxyTest: ' . $action);
    Helpers::jsonError($e->getUserMessage(), $e->getCode());
} catch (\Exception $e) {
    $logger->logException($e, 'ProxyTest: ' . $action);
    Helpers::jsonError('Test failed: ' . $e->getMessage(), 500);
}

/**
 * Test if proxy is alive
 */
function handleTestAlive(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';

    if (empty($proxyId)) {
        Helpers::jsonError('Proxy ID is required', 400);
    }

    $startTime = microtime(true);
    $response = $api->testProxyAlive($proxyId);
    $responseTime = round((microtime(true) - $startTime) * 1000, 2);

    $isAlive = $response['data']['alive'] ?? false;
    $status = $response['data']['status'] ?? 'unknown';
    $ip = $response['data']['ip'] ?? '';
    $location = $response['data']['location'] ?? '';
    $isp = $response['data']['isp'] ?? '';

    $logger->info('Proxy alive test', [
        'proxy_id' => $proxyId,
        'alive' => $isAlive,
        'response_time_ms' => $responseTime,
    ]);

    Helpers::jsonSuccess([
        'proxy_id' => $proxyId,
        'alive' => $isAlive,
        'status' => $status,
        'ip' => $ip,
        'location' => $location,
        'isp' => $isp,
        'response_time_ms' => $responseTime,
        'tested_at' => date('c'),
    ]);
}

/**
 * Test proxy connection speed
 */
function handleTestSpeed(ApiClient $api, Logger $logger): void
{
    $proxyId = $_POST['proxy_id'] ?? '';

    if (empty($proxyId)) {
        Helpers::jsonError('Proxy ID is required', 400);
    }

    $startTime = microtime(true);
    $response = $api->testProxySpeed($proxyId);
    $totalTime = round((microtime(true) - $startTime) * 1000, 2);

    $downloadSpeed = $response['data']['download_speed'] ?? 0;
    $uploadSpeed = $response['data']['upload_speed'] ?? 0;
    $latency = $response['data']['latency'] ?? 0;
    $jitter = $response['data']['jitter'] ?? 0;
    $packetLoss = $response['data']['packet_loss'] ?? 0;

    // Calculate quality rating
    $quality = calculateQualityRating($downloadSpeed, $latency, $packetLoss);

    $logger->info('Proxy speed test', [
        'proxy_id' => $proxyId,
        'download' => $downloadSpeed,
        'latency' => $latency,
    ]);

    Helpers::jsonSuccess([
        'proxy_id' => $proxyId,
        'download_speed' => [
            'bytes_per_second' => $downloadSpeed,
            'formatted' => Helpers::formatSpeed($downloadSpeed),
        ],
        'upload_speed' => [
            'bytes_per_second' => $uploadSpeed,
            'formatted' => Helpers::formatSpeed($uploadSpeed),
        ],
        'latency_ms' => round($latency, 2),
        'jitter_ms' => round($jitter, 2),
        'packet_loss_percent' => round($packetLoss, 2),
        'total_test_time_ms' => $totalTime,
        'quality_rating' => $quality,
        'tested_at' => date('c'),
    ]);
}

/**
 * Batch test all proxies in an order
 */
function handleBatchTest(ApiClient $api, string $orderId, Logger $logger): void
{
    if (empty($orderId)) {
        Helpers::jsonError('No active order', 400);
    }

    $proxies = $api->getOrderProxies($orderId);
    $proxyList = $proxies['data'] ?? [];

    $results = [];
    $alive = 0;
    $dead = 0;
    $totalSpeed = 0;
    $tested = 0;

    foreach ($proxyList as $proxy) {
        $proxyId = $proxy['id'] ?? '';
        if (empty($proxyId)) {
            continue;
        }

        try {
            $aliveResult = $api->testProxyAlive($proxyId);
            $isAlive = $aliveResult['data']['alive'] ?? false;

            if ($isAlive) {
                $alive++;

                try {
                    $speedResult = $api->testProxySpeed($proxyId);
                    $speed = $speedResult['data']['download_speed'] ?? 0;
                    $totalSpeed += $speed;
                    $tested++;

                    $results[] = [
                        'proxy_id' => $proxyId,
                        'ip' => $proxy['ip'] ?? '',
                        'alive' => true,
                        'speed' => Helpers::formatSpeed($speed),
                        'latency' => round($speedResult['data']['latency'] ?? 0, 2),
                    ];
                } catch (\Exception $e) {
                    $results[] = [
                        'proxy_id' => $proxyId,
                        'ip' => $proxy['ip'] ?? '',
                        'alive' => true,
                        'speed' => 'N/A',
                        'latency' => 'N/A',
                    ];
                }
            } else {
                $dead++;
                $results[] = [
                    'proxy_id' => $proxyId,
                    'ip' => $proxy['ip'] ?? '',
                    'alive' => false,
                    'speed' => 'N/A',
                    'latency' => 'N/A',
                ];
            }
        } catch (\Exception $e) {
            $dead++;
            $results[] = [
                'proxy_id' => $proxyId,
                'ip' => $proxy['ip'] ?? '',
                'alive' => false,
                'error' => $e->getMessage(),
            ];
        }
    }

    $avgSpeed = $tested > 0 ? $totalSpeed / $tested : 0;

    Helpers::jsonSuccess([
        'summary' => [
            'total' => count($proxyList),
            'alive' => $alive,
            'dead' => $dead,
            'avg_speed' => Helpers::formatSpeed($avgSpeed),
            'success_rate' => count($proxyList) > 0 ? round(($alive / count($proxyList)) * 100, 1) : 0,
        ],
        'results' => $results,
        'tested_at' => date('c'),
    ]);
}

/**
 * Calculate quality rating
 */
function calculateQualityRating(float $downloadSpeed, float $latency, float $packetLoss): string
{
    $score = 0;

    // Speed score (0-50)
    $speedMbps = ($downloadSpeed * 8) / 1000000;
    if ($speedMbps >= 50) {
        $score += 50;
    } elseif ($speedMbps >= 20) {
        $score += 40;
    } elseif ($speedMbps >= 10) {
        $score += 30;
    } elseif ($speedMbps >= 5) {
        $score += 20;
    } elseif ($speedMbps >= 1) {
        $score += 10;
    }

    // Latency score (0-30)
    if ($latency <= 50) {
        $score += 30;
    } elseif ($latency <= 100) {
        $score += 25;
    } elseif ($latency <= 200) {
        $score += 20;
    } elseif ($latency <= 500) {
        $score += 10;
    }

    // Packet loss score (0-20)
    if ($packetLoss === 0) {
        $score += 20;
    } elseif ($packetLoss <= 1) {
        $score += 15;
    } elseif ($packetLoss <= 5) {
        $score += 10;
    } elseif ($packetLoss <= 10) {
        $score += 5;
    }

    if ($score >= 80) {
        return 'Excellent';
    } elseif ($score >= 60) {
        return 'Good';
    } elseif ($score >= 40) {
        return 'Fair';
    } elseif ($score >= 20) {
        return 'Poor';
    }

    return 'Very Poor';
}

function buildTestModuleParams($service, $product): array
{
    return [
        'configoption1' => $product->configoption1 ?? '',
        'configoption2' => $product->configoption2 ?? '',
        'configoption3' => $product->configoption3 ?? 'https://api.cloudhost247.com',
        'configoption4' => $product->configoption4 ?? 30,
        'configoption15' => $product->configoption15 ?? 'on',
        'configoption16' => $product->configoption16 ?? 'INFO',
        'configoption17' => $product->configoption17 ?? 'on',
        'configoption18' => $product->configoption18 ?? 60,
    ];
}

function getTestConfig(array $params): array
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
