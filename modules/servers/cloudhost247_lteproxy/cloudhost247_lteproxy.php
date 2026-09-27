<?php

declare(strict_types=1);

/**
 * CloudHost247 Isc LTE Proxy Reseller Module for WHMCS
 *
 * A comprehensive WHMCS provisioning module that integrates with the
 * CloudHost247 LTE Proxy API to provide proxy reselling capabilities.
 *
 * @package CloudHost247\LTEProxy
 * @author CloudHost247 Isc
 * @version 1.0.0
 * @license Proprietary
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/lib/ApiException.php';
require_once __DIR__ . '/lib/Logger.php';
require_once __DIR__ . '/lib/RateLimiter.php';
require_once __DIR__ . '/lib/Cache.php';
require_once __DIR__ . '/lib/Helpers.php';
require_once __DIR__ . '/lib/ApiClient.php';

use CloudHost247\LTEProxy\ApiClient;
use CloudHost247\LTEProxy\ApiException;
use CloudHost247\LTEProxy\Logger;
use CloudHost247\LTEProxy\Cache;
use CloudHost247\LTEProxy\Helpers;

// Module metadata
const CH247_LTEPROXY_VERSION = '1.0.0';
const CH247_LTEPROXY_NAME = 'CloudHost247 Isc LTE Proxy Module';

/**
 * Define module configuration options
 *
 * @return array
 */
function cloudhost247_lteproxy_ConfigOptions(): array
{
    return [
        'api_key' => [
            'FriendlyName' => 'API Key',
            'Type' => 'text',
            'Size' => '64',
            'Description' => 'Your CloudHost247 API Key',
            'Required' => true,
        ],
        'api_secret' => [
            'FriendlyName' => 'API Secret',
            'Type' => 'password',
            'Size' => '64',
            'Description' => 'Your CloudHost247 API Secret',
            'Required' => true,
        ],
        'api_base_url' => [
            'FriendlyName' => 'API Base URL',
            'Type' => 'text',
            'Size' => '64',
            'Default' => 'https://api.cloudhost247.com',
            'Description' => 'The base URL for the CloudHost247 API',
        ],
        'api_timeout' => [
            'FriendlyName' => 'API Timeout (seconds)',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '30',
            'Description' => 'Request timeout in seconds',
        ],
        'proxy_type' => [
            'FriendlyName' => 'Default Proxy Type',
            'Type' => 'dropdown',
            'Options' => [
                'SOCKS5' => 'SOCKS5',
                'HTTPS' => 'HTTPS',
                'HTTP' => 'HTTP',
            ],
            'Default' => 'SOCKS5',
            'Description' => 'Default proxy protocol type',
        ],
        'connection_type' => [
            'FriendlyName' => 'Default Connection Type',
            'Type' => 'dropdown',
            'Options' => [
                'WIFI' => 'WiFi Only',
                'CELLULAR' => 'Cellular Only',
                'WIFI_AND_CELLULAR' => 'WiFi & Cellular',
            ],
            'Default' => 'WIFI_AND_CELLULAR',
            'Description' => 'Default connection type for proxies',
        ],
        'rotation_type' => [
            'FriendlyName' => 'Default Rotation Type',
            'Type' => 'dropdown',
            'Options' => [
                'manual' => 'Manual Rotation',
                'timed' => 'Timed Rotation',
                'per_request' => 'Per Request',
                'off' => 'No Rotation',
            ],
            'Default' => 'manual',
            'Description' => 'Default IP rotation setting',
        ],
        'rotation_interval' => [
            'FriendlyName' => 'Rotation Interval (minutes)',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '60',
            'Description' => 'Minutes between automatic rotations (for timed mode)',
        ],
        'region' => [
            'FriendlyName' => 'Default Region',
            'Type' => 'dropdown',
            'Options' => [
                'us' => 'United States',
                'us_east' => 'US East Coast',
                'us_west' => 'US West Coast',
                'us_central' => 'US Central',
                'ca' => 'Canada',
                'uk' => 'United Kingdom',
                'de' => 'Germany',
                'fr' => 'France',
                'nl' => 'Netherlands',
            ],
            'Default' => 'us',
            'Description' => 'Default proxy region',
        ],
        'carrier' => [
            'FriendlyName' => 'Default Carrier',
            'Type' => 'dropdown',
            'Options' => [
                'verizon' => 'Verizon',
                'att' => 'AT&T',
                'tmobile' => 'T-Mobile',
                'sprint' => 'Sprint',
                'us_cellular' => 'US Cellular',
                'rogers' => 'Rogers (CA)',
                'bell' => 'Bell (CA)',
                'ee' => 'EE (UK)',
                'vodafone_uk' => 'Vodafone (UK)',
            ],
            'Default' => 'verizon',
            'Description' => 'Default mobile carrier',
        ],
        'auth_type' => [
            'FriendlyName' => 'Default Authentication',
            'Type' => 'dropdown',
            'Options' => [
                'username_password' => 'Username & Password',
                'ip_whitelist' => 'IP Whitelist',
                'both' => 'Both Methods',
            ],
            'Default' => 'username_password',
            'Description' => 'Default proxy authentication method',
        ],
        'trial_enabled' => [
            'FriendlyName' => 'Enable Trial Proxies',
            'Type' => 'yesno',
            'Description' => 'Allow clients to request trial proxies',
        ],
        'trial_duration' => [
            'FriendlyName' => 'Trial Duration (hours)',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '24',
            'Description' => 'Duration of trial proxy access',
        ],
        'auto_provision' => [
            'FriendlyName' => 'Auto-Provision on Payment',
            'Type' => 'yesno',
            'Default' => 'on',
            'Description' => 'Automatically provision proxies after payment',
        ],
        'logging_enabled' => [
            'FriendlyName' => 'Enable Logging',
            'Type' => 'yesno',
            'Default' => 'on',
            'Description' => 'Enable module activity logging',
        ],
        'log_level' => [
            'FriendlyName' => 'Log Level',
            'Type' => 'dropdown',
            'Options' => [
                'DEBUG' => 'Debug (All)',
                'INFO' => 'Info',
                'WARNING' => 'Warning',
                'ERROR' => 'Error Only',
            ],
            'Default' => 'INFO',
            'Description' => 'Minimum log level to record',
        ],
        'cache_enabled' => [
            'FriendlyName' => 'Enable Response Caching',
            'Type' => 'yesno',
            'Default' => 'on',
            'Description' => 'Cache API responses for better performance',
        ],
        'rate_limit_requests' => [
            'FriendlyName' => 'Rate Limit (requests/min)',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '60',
            'Description' => 'Maximum API requests per minute',
        ],
    ];
}

/**
 * Create a new proxy service
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_CreateAccount(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $logger->info('Creating proxy account', ['service_id' => $params['serviceid']]);

        $api = getCh247ApiClient($params);

        // Build order parameters
        $orderParams = [
            'quantity' => (int) ($params['configoptions']['quantity'] ?? $params['configoption4'] ?? 1),
            'region' => $params['configoptions']['region'] ?? $params['configoption9'] ?? 'us',
            'carrier' => $params['configoptions']['carrier'] ?? $params['configoption10'] ?? 'verizon',
            'proxy_type' => $params['configoptions']['proxy_type'] ?? $params['configoption5'] ?? 'SOCKS5',
            'duration' => (int) ($params['configoptions']['duration'] ?? $params['configoptions']['billingcycle_days'] ?? 30),
            'connection_type' => $params['configoptions']['connection_type'] ?? $params['configoption6'] ?? 'WIFI_AND_CELLULAR',
            'rotation' => $params['configoptions']['rotation_type'] ?? $params['configoption7'] ?? 'manual',
            'auth_type' => $params['configoptions']['auth_type'] ?? $params['configoption11'] ?? 'username_password',
            'client_id' => $params['clientsdetails']['userid'],
            'client_email' => $params['clientsdetails']['email'],
            'service_id' => $params['serviceid'],
        ];

        // Add IP whitelist if applicable
        if (in_array($orderParams['auth_type'], ['ip_whitelist', 'both'], true)) {
            $orderParams['client_ip'] = Helpers::getClientIp();
        }

        // Determine if this is a 1:1 proxy order
        $isOneByOne = (int) ($params['configoptions']['proxy_mode'] ?? 0) === 1;

        if ($isOneByOne || $orderParams['quantity'] === 1) {
            $response = $api->buyProxy1By1($orderParams);
        } else {
            $response = $api->buyProxy($orderParams);
        }

        if (isset($response['success']) && $response['success'] === true) {
            $orderId = $response['data']['order_id'] ?? '';

            // Store order reference
            Capsule::table('tblhosting')
                ->where('id', $params['serviceid'])
                ->update([
                    'username' => $orderId,
                    'notes' => 'CloudHost247 Proxy Order: ' . $orderId,
                ]);

            // Log the order
            $logger->logModuleAction('create', (int) $params['serviceid'], [
                'order_id' => $orderId,
                'quantity' => $orderParams['quantity'],
                'region' => $orderParams['region'],
            ]);

            // Send notification
            sendCh247Notification(
                $params['clientsdetails']['userid'],
                'Proxy Order Activated',
                'Your LTE proxy order has been activated. Order ID: ' . $orderId
            );

            return 'success';
        }

        $errorMsg = $response['message'] ?? 'Unknown error during proxy creation';
        $logger->error('Proxy creation failed', ['error' => $errorMsg]);

        return $errorMsg;
    } catch (ApiException $e) {
        $logger->logException($e, 'CreateAccount');
        return $e->getUserMessage();
    } catch (\Exception $e) {
        $logger->logException($e, 'CreateAccount');
        return 'An error occurred: ' . $e->getMessage();
    }
}

/**
 * Terminate a proxy service
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_TerminateAccount(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $logger->info('Terminating proxy account', ['service_id' => $params['serviceid']]);

        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            $logger->warning('No order ID found for termination', ['service_id' => $params['serviceid']]);
            return 'No order ID found. Service may already be terminated.';
        }

        $api = getCh247ApiClient($params);
        $response = $api->cancelOrder($orderId, 'Service terminated by WHMCS');

        if (isset($response['success']) && $response['success'] === true) {
            $logger->logModuleAction('terminate', (int) $params['serviceid'], ['order_id' => $orderId]);
            return 'success';
        }

        $errorMsg = $response['message'] ?? 'Unknown error during termination';
        $logger->error('Termination failed', ['error' => $errorMsg]);

        return $errorMsg;
    } catch (ApiException $e) {
        $logger->logException($e, 'TerminateAccount');
        return $e->getUserMessage();
    } catch (\Exception $e) {
        $logger->logException($e, 'TerminateAccount');
        return 'An error occurred: ' . $e->getMessage();
    }
}

/**
 * Suspend a proxy service
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_SuspendAccount(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $logger->info('Suspending proxy account', ['service_id' => $params['serviceid']]);

        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found.';
        }

        // Note: API may not have a direct suspend endpoint
        // We'll store the suspended state locally
        Capsule::table('tblhosting')
            ->where('id', $params['serviceid'])
            ->update([
                'notes' => 'SUSPENDED - ' . ($params['suspendreason'] ?? 'Manual suspension'),
            ]);

        $logger->logModuleAction('suspend', (int) $params['serviceid'], ['order_id' => $orderId]);

        return 'success';
    } catch (\Exception $e) {
        $logger->logException($e, 'SuspendAccount');
        return 'An error occurred: ' . $e->getMessage();
    }
}

/**
 * Unsuspend a proxy service
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_UnsuspendAccount(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $logger->info('Unsuspending proxy account', ['service_id' => $params['serviceid']]);

        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found.';
        }

        // Restore the order note
        Capsule::table('tblhosting')
            ->where('id', $params['serviceid'])
            ->update([
                'notes' => 'CloudHost247 Proxy Order: ' . $orderId,
            ]);

        $logger->logModuleAction('unsuspend', (int) $params['serviceid'], ['order_id' => $orderId]);

        return 'success';
    } catch (\Exception $e) {
        $logger->logException($e, 'UnsuspendAccount');
        return 'An error occurred: ' . $e->getMessage();
    }
}

/**
 * Renew a proxy service
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_Renew(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $logger->info('Renewing proxy account', ['service_id' => $params['serviceid']]);

        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found for renewal.';
        }

        $api = getCh247ApiClient($params);

        $duration = (int) ($params['configoptions']['duration'] ?? $params['configoptions']['billingcycle_days'] ?? 30);
        $response = $api->extendOrder($orderId, $duration);

        if (isset($response['success']) && $response['success'] === true) {
            $logger->logModuleAction('renew', (int) $params['serviceid'], [
                'order_id' => $orderId,
                'duration' => $duration,
            ]);

            sendCh247Notification(
                $params['clientsdetails']['userid'],
                'Proxy Order Renewed',
                'Your LTE proxy order has been renewed for ' . $duration . ' days.'
            );

            return 'success';
        }

        $errorMsg = $response['message'] ?? 'Unknown error during renewal';
        $logger->error('Renewal failed', ['error' => $errorMsg]);

        return $errorMsg;
    } catch (ApiException $e) {
        $logger->logException($e, 'Renew');
        return $e->getUserMessage();
    } catch (\Exception $e) {
        $logger->logException($e, 'Renew');
        return 'An error occurred: ' . $e->getMessage();
    }
}

/**
 * Change password for proxy service
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_ChangePassword(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $logger->info('Changing proxy password', ['service_id' => $params['serviceid']]);

        $orderId = $params['username'] ?? '';
        $newPassword = $params['password'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found.';
        }

        $api = getCh247ApiClient($params);
        $proxies = $api->getOrderProxies($orderId);

        if (isset($proxies['data']) && is_array($proxies['data'])) {
            foreach ($proxies['data'] as $proxy) {
                $proxyId = $proxy['id'] ?? '';
                if (!empty($proxyId)) {
                    $api->updateProxyAuth($proxyId, [
                        'auth_type' => 'username_password',
                        'password' => $newPassword,
                    ]);
                }
            }
        }

        $logger->logModuleAction('change_password', (int) $params['serviceid'], ['order_id' => $orderId]);

        return 'success';
    } catch (ApiException $e) {
        $logger->logException($e, 'ChangePassword');
        return $e->getUserMessage();
    } catch (\Exception $e) {
        $logger->logException($e, 'ChangePassword');
        return 'An error occurred: ' . $e->getMessage();
    }
}

/**
 * Test connection to API
 *
 * @param array $params Module parameters
 * @return array
 */
function cloudhost247_lteproxy_TestConnection(array $params): array
{
    $logger = getCh247Logger($params);

    try {
        $api = getCh247ApiClient($params);
        $valid = $api->validateCredentials();

        if ($valid) {
            $accountInfo = $api->getAccountInfo();
            $balance = $api->getBalance();

            return [
                'success' => true,
                'error' => '',
                'info' => [
                    'Account Status' => $accountInfo['data']['status'] ?? 'Active',
                    'Balance' => '$' . ($balance['data']['balance'] ?? '0.00'),
                    'API Version' => $accountInfo['data']['api_version'] ?? '1.0',
                ],
            ];
        }

        return [
            'success' => false,
            'error' => 'API authentication failed. Please check your API key and secret.',
        ];
    } catch (ApiException $e) {
        $logger->logException($e, 'TestConnection');
        return [
            'success' => false,
            'error' => $e->getMessage(),
        ];
    } catch (\Exception $e) {
        $logger->logException($e, 'TestConnection');
        return [
            'success' => false,
            'error' => 'Connection error: ' . $e->getMessage(),
        ];
    }
}

/**
 * Admin services tab
 *
 * @param array $params Module parameters
 * @return array
 */
function cloudhost247_lteproxy_AdminServicesTabFields(array $params): array
{
    $orderId = $params['username'] ?? '';

    $fields = [];
    $fields['Order ID'] = !empty($orderId)
        ? '<code>' . htmlspecialchars($orderId) . '</code>'
        : '<span class="label label-warning">Not Provisioned</span>';

    return $fields;
}

/**
 * Client area output
 *
 * @param array $params Module parameters
 * @return array
 */
function cloudhost247_lteproxy_ClientArea(array $params): array
{
    $logger = getCh247Logger($params);
    $orderId = $params['username'] ?? '';

    $requestedAction = $_GET['action'] ?? 'dashboard';

    try {
        $api = getCh247ApiClient($params);

        // Get account info for display
        $accountInfo = [];
        try {
            $accountInfo = $api->getAccountInfo();
        } catch (\Exception $e) {
            // Non-critical
        }

        $proxies = [];
        $orderDetails = [];

        if (!empty($orderId)) {
            try {
                $proxies = $api->getOrderProxies($orderId);
                $orderDetails = $api->getOrders(['order_id' => $orderId]);
            } catch (\Exception $e) {
                $logger->warning('Failed to load proxy details', [
                    'order_id' => $orderId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $balance = ['data' => ['balance' => 0]];
        try {
            $balance = $api->getBalance();
        } catch (\Exception $e) {
            // Non-critical
        }

        return [
            'tabOverviewReplacementTemplate' => 'templates/client/dashboard.tpl',
            'templateVariables' => [
                'orderId' => $orderId,
                'proxies' => $proxies['data'] ?? [],
                'orderDetails' => $orderDetails['data'][0] ?? [],
                'balance' => $balance['data']['balance'] ?? 0,
                'accountInfo' => $accountInfo['data'] ?? [],
                'moduleVersion' => CH247_LTEPROXY_VERSION,
                'requestedAction' => $requestedAction,
                'csrfToken' => Helpers::generateCsrfToken(),
                'serviceId' => $params['serviceid'],
                'regions' => Helpers::getRegions(),
                'carriers' => Helpers::getAllCarriers(),
                'proxyTypes' => Helpers::getProxyTypes(),
                'rotationTypes' => Helpers::getRotationTypes(),
                'authTypes' => Helpers::getAuthTypes(),
                'connectionTypes' => Helpers::getConnectionTypes(),
            ],
        ];
    } catch (\Exception $e) {
        $logger->logException($e, 'ClientArea');
        return [
            'tabOverviewReplacementTemplate' => 'templates/client/error.tpl',
            'templateVariables' => [
                'error' => 'Failed to load proxy dashboard. Please try again later.',
            ],
        ];
    }
}

/**
 * Admin area custom button array
 *
 * @param array $params Module parameters
 * @return array
 */
function cloudhost247_lteproxy_AdminCustomButtonArray(): array
{
    return [
        'Rotate All IPs' => 'adminRotateAll',
        'Test All Proxies' => 'adminTestAll',
        'Sync Status' => 'adminSyncStatus',
        'Extend Order' => 'adminExtendOrder',
        'Reveal 1:1 IPs' => 'adminRevealIPs',
    ];
}

/**
 * Admin rotate all IPs action
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_adminRotateAll(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found.';
        }

        $api = getCh247ApiClient($params);
        $proxies = $api->getOrderProxies($orderId);
        $rotated = 0;
        $failed = 0;

        if (isset($proxies['data']) && is_array($proxies['data'])) {
            foreach ($proxies['data'] as $proxy) {
                $proxyId = $proxy['id'] ?? '';
                if (!empty($proxyId)) {
                    try {
                        $api->rotateProxyIp($proxyId);
                        $rotated++;
                    } catch (\Exception $e) {
                        $failed++;
                    }
                }
            }
        }

        $logger->info('Admin rotated all IPs', [
            'order_id' => $orderId,
            'rotated' => $rotated,
            'failed' => $failed,
        ]);

        return 'Rotated ' . $rotated . ' proxies. Failed: ' . $failed;
    } catch (\Exception $e) {
        $logger->logException($e, 'adminRotateAll');
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Admin test all proxies action
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_adminTestAll(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found.';
        }

        $api = getCh247ApiClient($params);
        $proxies = $api->getOrderProxies($orderId);
        $alive = 0;
        $dead = 0;

        if (isset($proxies['data']) && is_array($proxies['data'])) {
            foreach ($proxies['data'] as $proxy) {
                $proxyId = $proxy['id'] ?? '';
                if (!empty($proxyId)) {
                    try {
                        $result = $api->testProxyAlive($proxyId);
                        if ($result['data']['alive'] ?? false) {
                            $alive++;
                        } else {
                            $dead++;
                        }
                    } catch (\Exception $e) {
                        $dead++;
                    }
                }
            }
        }

        return 'Test Results - Alive: ' . $alive . ', Dead: ' . $dead;
    } catch (\Exception $e) {
        $logger->logException($e, 'adminTestAll');
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Admin sync status action
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_adminSyncStatus(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found.';
        }

        $api = getCh247ApiClient($params);
        $orders = $api->getOrders(['order_id' => $orderId]);

        $status = $orders['data'][0]['status'] ?? 'unknown';

        return 'Order status synchronized: ' . ucfirst($status);
    } catch (\Exception $e) {
        $logger->logException($e, 'adminSyncStatus');
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Admin extend order action
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_adminExtendOrder(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found.';
        }

        $api = getCh247ApiClient($params);
        $duration = (int) ($params['configoptions']['duration'] ?? 30);
        $response = $api->extendOrder($orderId, $duration);

        if (isset($response['success']) && $response['success'] === true) {
            return 'Order extended by ' . $duration . ' days.';
        }

        return 'Failed to extend order: ' . ($response['message'] ?? 'Unknown error');
    } catch (\Exception $e) {
        $logger->logException($e, 'adminExtendOrder');
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Admin reveal 1:1 IPs action
 *
 * @param array $params Module parameters
 * @return string
 */
function cloudhost247_lteproxy_adminRevealIPs(array $params): string
{
    $logger = getCh247Logger($params);

    try {
        $orderId = $params['username'] ?? '';

        if (empty($orderId)) {
            return 'No order ID found.';
        }

        $api = getCh247ApiClient($params);
        $proxies = $api->getOrderProxies($orderId);
        $revealed = 0;

        if (isset($proxies['data']) && is_array($proxies['data'])) {
            foreach ($proxies['data'] as $proxy) {
                $proxyId = $proxy['id'] ?? '';
                if (!empty($proxyId)) {
                    try {
                        $api->reveal1By1ProxyIp($proxyId);
                        $revealed++;
                    } catch (\Exception $e) {
                        // Skip non-1:1 proxies
                    }
                }
            }
        }

        return 'Revealed IPs for ' . $revealed . ' proxies.';
    } catch (\Exception $e) {
        $logger->logException($e, 'adminRevealIPs');
        return 'Error: ' . $e->getMessage();
    }
}

/**
 * Get module configuration
 *
 * @param array $params Module parameters
 * @return array
 */
function getCh247Config(array $params): array
{
    return [
        'api_key' => $params['configoption1'] ?? '',
        'api_secret' => $params['configoption2'] ?? '',
        'api_base_url' => $params['configoption3'] ?? 'https://api.cloudhost247.com',
        'api_timeout' => (int) ($params['configoption4'] ?? 30),
        'proxy_type' => $params['configoption5'] ?? 'SOCKS5',
        'connection_type' => $params['configoption6'] ?? 'WIFI_AND_CELLULAR',
        'rotation_type' => $params['configoption7'] ?? 'manual',
        'rotation_interval' => (int) ($params['configoption8'] ?? 60),
        'region' => $params['configoption9'] ?? 'us',
        'carrier' => $params['configoption10'] ?? 'verizon',
        'auth_type' => $params['configoption11'] ?? 'username_password',
        'trial_enabled' => (bool) ($params['configoption12'] ?? false),
        'trial_duration' => (int) ($params['configoption13'] ?? 24),
        'auto_provision' => (bool) ($params['configoption14'] ?? true),
        'logging_enabled' => (bool) ($params['configoption15'] ?? true),
        'log_level' => $params['configoption16'] ?? 'INFO',
        'cache_enabled' => (bool) ($params['configoption17'] ?? true),
        'rate_limit_requests' => (int) ($params['configoption18'] ?? 60),
        'log_directory' => __DIR__ . '/logs',
        'cache_directory' => __DIR__ . '/cache',
    ];
}

/**
 * Get API client instance
 *
 * @param array $params Module parameters
 * @return ApiClient
 */
function getCh247ApiClient(array $params): ApiClient
{
    $config = getCh247Config($params);
    $logger = getCh247Logger($params);

    return new ApiClient($config, $logger);
}

/**
 * Get logger instance
 *
 * @param array $params Module parameters
 * @return Logger
 */
function getCh247Logger(array $params): Logger
{
    $config = getCh247Config($params);

    return new Logger($config);
}

/**
 * Send client notification
 *
 * @param int $clientId Client ID
 * @param string $subject Subject
 * @param string $message Message
 * @return void
 */
function sendCh247Notification(int $clientId, string $subject, string $message): void
{
    try {
        $command = 'SendEmail';
        $postData = [
            'id' => $clientId,
            'customtype' => 'general',
            'customsubject' => $subject,
            'custommessage' => $message,
        ];

        $results = localAPI($command, $postData);

        if ($results['result'] !== 'success') {
            logActivity('CloudHost247 LTE Proxy: Failed to send notification - ' . ($results['message'] ?? 'Unknown error'));
        }
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Notification error - ' . $e->getMessage());
    }
}

/**
 * Module metadata for WHMCS
 *
 * @return array
 */
function cloudhost247_lteproxy_MetaData(): array
{
    return [
        'DisplayName' => CH247_LTEPROXY_NAME,
        'APIVersion' => '1.1',
        'RequiresServer' => false,
        'DefaultNonSSLPort' => '80',
        'DefaultSSLPort' => '443',
        'ServiceSingleSignOnLabel' => 'Login to Proxy Dashboard',
    ];
}
