<?php

declare(strict_types=1);

/**
 * CloudHost247 LTE Proxy Notification Hooks
 *
 * Handles client notifications for proxy-related events.
 *
 * @package CloudHost247\LTEProxy\Hooks
 * @version 1.0.0
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

/**
 * Hook: After Module Create - Send welcome notification
 */
add_hook('AfterModuleCreate', 1, function ($vars) {
    $serviceId = $vars['params']['serviceid'] ?? 0;

    if (empty($serviceId)) {
        return;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
            ->where('tblhosting.id', $serviceId)
            ->select('tblhosting.*', 'tblproducts.servertype')
            ->first();

        if (!$service || $service->servertype !== 'cloudhost247_lteproxy') {
            return;
        }

        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();

        if (!$client) {
            return;
        }

        $orderId = $service->username ?? '';

        if (!empty($orderId)) {
            sendCh247Notification(
                (int) $client->id,
                'Your LTE Proxy is Ready',
                'Your LTE proxy order has been successfully provisioned. Order ID: ' . $orderId . "\n\nYou can manage your proxies from the client area."
            );
        }
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Notification hook error - ' . $e->getMessage());
    }
});

/**
 * Hook: After Module Terminate - Send termination notification
 */
add_hook('AfterModuleTerminate', 1, function ($vars) {
    $serviceId = $vars['params']['serviceid'] ?? 0;

    if (empty($serviceId)) {
        return;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
            ->where('tblhosting.id', $serviceId)
            ->select('tblhosting.*', 'tblproducts.servertype')
            ->first();

        if (!$service || $service->servertype !== 'cloudhost247_lteproxy') {
            return;
        }

        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();

        if (!$client) {
            return;
        }

        sendCh247Notification(
            (int) $client->id,
            'LTE Proxy Service Terminated',
            'Your LTE proxy service has been terminated. All associated proxies have been cancelled.'
        );
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Termination notification error - ' . $e->getMessage());
    }
});

/**
 * Hook: After Module Suspend - Send suspension notification
 */
add_hook('AfterModuleSuspend', 1, function ($vars) {
    $serviceId = $vars['params']['serviceid'] ?? 0;

    if (empty($serviceId)) {
        return;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
            ->where('tblhosting.id', $serviceId)
            ->select('tblhosting.*', 'tblproducts.servertype')
            ->first();

        if (!$service || $service->servertype !== 'cloudhost247_lteproxy') {
            return;
        }

        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();

        if (!$client) {
            return;
        }

        $reason = $vars['params']['suspendreason'] ?? 'Unspecified';

        sendCh247Notification(
            (int) $client->id,
            'LTE Proxy Service Suspended',
            'Your LTE proxy service has been suspended.\n\nReason: ' . $reason . '\n\nPlease contact support if you believe this is an error.'
        );
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Suspend notification error - ' . $e->getMessage());
    }
});

/**
 * Hook: After Module Unsuspend - Send unsuspension notification
 */
add_hook('AfterModuleUnsuspend', 1, function ($vars) {
    $serviceId = $vars['params']['serviceid'] ?? 0;

    if (empty($serviceId)) {
        return;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
            ->where('tblhosting.id', $serviceId)
            ->select('tblhosting.*', 'tblproducts.servertype')
            ->first();

        if (!$service || $service->servertype !== 'cloudhost247_lteproxy') {
            return;
        }

        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();

        if (!$client) {
            return;
        }

        sendCh247Notification(
            (int) $client->id,
            'LTE Proxy Service Reactivated',
            'Your LTE proxy service has been reactivated and is now fully operational.'
        );
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Unsuspend notification error - ' . $e->getMessage());
    }
});

/**
 * Hook: Pre-Module Renew - Send renewal reminder
 */
add_hook('PreModuleRenew', 1, function ($vars) {
    $serviceId = $vars['params']['serviceid'] ?? 0;

    if (empty($serviceId)) {
        return;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
            ->where('tblhosting.id', $serviceId)
            ->select('tblhosting.*', 'tblproducts.servertype')
            ->first();

        if (!$service || $service->servertype !== 'cloudhost247_lteproxy') {
            return;
        }

        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();

        if (!$client) {
            return;
        }

        $daysUntilExpiry = max(0, (int) floor((strtotime($service->nextduedate) - time()) / 86400));

        sendCh247Notification(
            (int) $client->id,
            'LTE Proxy Renewal Processing',
            'Your LTE proxy service is being renewed. Order ID: ' . ($service->username ?? 'N/A') . '\nExpiry in: ' . $daysUntilExpiry . ' days.'
        );
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Renewal notification error - ' . $e->getMessage());
    }
});

/**
 * Hook: After Module Renew - Send renewal confirmation
 */
add_hook('AfterModuleRenew', 1, function ($vars) {
    $serviceId = $vars['params']['serviceid'] ?? 0;

    if (empty($serviceId)) {
        return;
    }

    try {
        $service = Capsule::table('tblhosting')
            ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
            ->where('tblhosting.id', $serviceId)
            ->select('tblhosting.*', 'tblproducts.servertype')
            ->first();

        if (!$service || $service->servertype !== 'cloudhost247_lteproxy') {
            return;
        }

        $client = Capsule::table('tblclients')
            ->where('id', $service->userid)
            ->first();

        if (!$client) {
            return;
        }

        sendCh247Notification(
            (int) $client->id,
            'LTE Proxy Renewal Complete',
            'Your LTE proxy service has been successfully renewed. New expiry date: ' . $service->nextduedate
        );
    } catch (\Exception $e) {
        logActivity('CloudHost247 LTE Proxy: Post-renewal notification error - ' . $e->getMessage());
    }
});
