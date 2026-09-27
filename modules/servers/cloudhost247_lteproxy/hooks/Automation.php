<?php

declare(strict_types=1);

/**
 * CloudHost247 LTE Proxy Automation Hooks
 *
 * Handles automated provisioning, suspension, and notifications
 * for the LTE Proxy module.
 *
 * @package CloudHost247\LTEProxy\Hooks
 * @version 1.0.0
 */

use CloudHost247\LTEProxy\ApiClient;
use CloudHost247\LTEProxy\Logger;
use CloudHost247\LTEProxy\Helpers;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/../lib/ApiException.php';
require_once __DIR__ . '/../lib/Logger.php';
require_once __DIR__ . '/../lib/Cache.php';
require_once __DIR__ . '/../lib/Helpers.php';
require_once __DIR__ . '/../lib/RateLimiter.php';
require_once __DIR__ . '/../lib/ApiClient.php';

/**
 * Hook: Invoice Paid - Auto-provision proxies
 */
add_hook('InvoicePaid', 1, function ($vars) {
    $invoiceId = $vars['invoiceid'] ?? 0;

    if (empty($invoiceId)) {
        return;
    }

    try {
        $invoiceItems = Capsule::table('tblinvoiceitems')
            ->where('invoiceid', $invoiceId)
            ->where('type', 'Hosting')
            ->get();

        foreach ($invoiceItems as $item) {
            $serviceId = $item->relid ?? 0;

            if (empty($serviceId)) {
                continue;
            }

            $service = Capsule::table('tblhosting')
                ->where('id', $serviceId)
                ->first();

            if (!$service || $service->domainstatus !== 'Pending') {
                continue;
            }

            // Check if this is our module
            $product = Capsule::table('tblproducts')
                ->where('id', $service->packageid)
                ->first();

            if (!$product || $product->servertype !== 'cloudhost247_lteproxy') {
                continue;
            }

            // Check if auto-provision is enabled
            $autoProvision = (bool) ($product->configoption14 ?? true);

            if (!$autoProvision) {
                continue;
            }

            // Build params for provisioning
            $client = Capsule::table('tblclients')
                ->where('id', $service->userid)
                ->first();

            if (!$client) {
                continue;
            }

            $params = [
                'serviceid' => $serviceId,
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
                'clientsdetails' => [
                    'userid' => $client->id,
                    'email' => $client->email,
                ],
            ];

            // Call CreateAccount
            $result = cloudhost247_lteproxy_CreateAccount($params);

            if ($result === 'success') {
                // Update service status
                Capsule::table('tblhosting')
                    ->where('id', $serviceId)
                    ->update([
                        'domainstatus' => 'Active',
                        'nextduedate' => date('Y-m-d', strtotime('+30 days')),
                    ]);

                logActivity('CloudHost247 LTE Proxy: Auto-provisioned service ' . $serviceId);
            } else {
                logActivity('CloudHost247 LTE Proxy: Auto-provision failed for service ' . $serviceId . ' - ' . $result);
            }
        }
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Auto-provision error - ' . $e->getMessage());
    }
});

/**
 * Hook: Service Suspension - Handle proxy suspension
 */
add_hook('ServiceSuspend', 1, function ($vars) {
    $serviceId = $vars['serviceid'] ?? 0;

    if (empty($serviceId)) {
        return;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->where('id', $serviceId)
            ->first();

        if (!$service) {
            return;
        }

        // Verify this is our module
        $product = Capsule::table('tblproducts')
            ->where('id', $service->packageid)
            ->first();

        if (!$product || $product->servertype !== 'cloudhost247_lteproxy') {
            return;
        }

        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();

        $params = [
            'serviceid' => $serviceId,
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
            'clientsdetails' => [
                'userid' => $client->id ?? 0,
                'email' => $client->email ?? '',
            ],
        ];

        cloudhost247_lteproxy_SuspendAccount($params);
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Suspend hook error - ' . $e->getMessage());
    }
});

/**
 * Hook: Service Unsuspension - Handle proxy unsuspension
 */
add_hook('ServiceUnsuspend', 1, function ($vars) {
    $serviceId = $vars['serviceid'] ?? 0;

    if (empty($serviceId)) {
        return;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->where('id', $serviceId)
            ->first();

        if (!$service) {
            return;
        }

        $product = Capsule::table('tblproducts')
            ->where('id', $service->packageid)
            ->first();

        if (!$product || $product->servertype !== 'cloudhost247_lteproxy') {
            return;
        }

        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();

        $params = [
            'serviceid' => $serviceId,
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
            'clientsdetails' => [
                'userid' => $client->id ?? 0,
                'email' => $client->email ?? '',
            ],
        ];

        cloudhost247_lteproxy_UnsuspendAccount($params);
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Unsuspend hook error - ' . $e->getMessage());
    }
});

/**
 * Hook: Daily Cron - Check for expired orders and send alerts
 */
add_hook('DailyCronJob', 1, function () {
    try {
        // Get all active LTE proxy services
        $services = Capsule::table('tblhosting')
            ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
            ->where('tblproducts.servertype', 'cloudhost247_lteproxy')
            ->where('tblhosting.domainstatus', 'Active')
            ->select('tblhosting.*')
            ->get();

        foreach ($services as $service) {
            $daysUntilExpiry = (int) floor((strtotime($service->nextduedate) - time()) / 86400);

            // Send expiry warnings
            if (in_array($daysUntilExpiry, [7, 3, 1], true)) {
                $client = Capsule::table('tblclients')
                    ->where('id', $service->userid)
                    ->first();

                if ($client) {
                    $subject = 'LTE Proxy Expiry Warning - ' . $daysUntilExpiry . ' days remaining';
                    $message = 'Your LTE proxy service (Order: ' . ($service->username ?? 'N/A') . ') will expire in ' . $daysUntilExpiry . ' days. Please renew to avoid service interruption.';

                    sendCh247Notification((int) $client->id, $subject, $message);
                }
            }

            // Auto-cancel if expired by more than 7 days
            if ($daysUntilExpiry < -7 && !empty($service->username)) {
                $product = Capsule::table('tblproducts')
                    ->where('id', $service->packageid)
                    ->first();

                if ($product) {
                    $params = [
                        'serviceid' => $service->id,
                        'username' => $service->username,
                        'configoption1' => $product->configoption1 ?? '',
                        'configoption2' => $product->configoption2 ?? '',
                        'configoption3' => $product->configoption3 ?? 'https://api.cloudhost247.com',
                    ];

                    cloudhost247_lteproxy_TerminateAccount($params);

                    Capsule::table('tblhosting')
                        ->where('id', $service->id)
                        ->update(['domainstatus' => 'Cancelled']);

                    logActivity('CloudHost247 LTE Proxy: Auto-cancelled expired service ' . $service->id);
                }
            }
        }
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Daily cron error - ' . $e->getMessage());
    }
});

/**
 * Hook: Client Area Page - Inject custom assets
 */
add_hook('ClientAreaPage', 1, function ($vars) {
    $currentPage = $vars['filename'] ?? '';

    if ($currentPage !== 'clientarea' || ($vars['action'] ?? '') !== 'productdetails') {
        return $vars;
    }

    // Check if this is our module
    $serviceId = $vars['id'] ?? 0;

    if (empty($serviceId)) {
        return $vars;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->where('id', $serviceId)
            ->first();

        if (!$service) {
            return $vars;
        }

        $product = Capsule::table('tblproducts')
            ->where('id', $service->packageid)
            ->first();

        if ($product && $product->servertype === 'cloudhost247_lteproxy') {
            // Add CSS and JS to header output
            $assetPath = 'modules/servers/cloudhost247_lteproxy/assets';

            $vars['headoutput'] = ($vars['headoutput'] ?? '') . PHP_EOL
                . '<link rel="stylesheet" href="' . $assetPath . '/css/client.css?v=1.0.0">' . PHP_EOL;

            $vars['footeroutput'] = ($vars['footeroutput'] ?? '') . PHP_EOL
                . '<script src="' . $assetPath . '/js/client.js?v=1.0.0"></script>' . PHP_EOL;
        }
    } catch (\Exception $e) {
        // Silently fail - don't break the page
    }

    return $vars;
});

/**
 * Hook: Admin Area Page Output - Inject admin assets
 */
add_hook('AdminAreaPage', 1, function ($vars) {
    $currentPage = $vars['filename'] ?? '';

    if ($currentPage !== 'clientsservices') {
        return $vars;
    }

    $serviceId = $_GET['id'] ?? 0;

    if (empty($serviceId)) {
        return $vars;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->where('id', $serviceId)
            ->first();

        if (!$service) {
            return $vars;
        }

        $product = Capsule::table('tblproducts')
            ->where('id', $service->packageid)
            ->first();

        if ($product && $product->servertype === 'cloudhost247_lteproxy') {
            $assetPath = 'modules/servers/cloudhost247_lteproxy/assets';

            $vars['headoutput'] = ($vars['headoutput'] ?? '') . PHP_EOL
                . '<link rel="stylesheet" href="' . $assetPath . '/css/admin.css?v=1.0.0">' . PHP_EOL;
        }
    } catch (\Exception $e) {
        // Silently fail
    }

    return $vars;
});
