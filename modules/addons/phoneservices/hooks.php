<?php
/**
 * Phone Services - WHMCS hook integrations.
 *
 * Covers the scheduled lifecycle work (renewals, expiries, retention), billing
 * reconciliation, client-area asset injection and service teardown.
 *
 * @package PhoneServices
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';

use PhoneServices\Core\Config;
use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Providers\ProviderRegistry;
use PhoneServices\Services\Cron;

/**
 * Daily lifecycle run: renewals, expiries, usage sync and retention pruning.
 */
add_hook('DailyCronJob', 1, static function ($vars) {
    try {
        $cron = new Cron();
        $summary = $cron->runDaily();

        Logger::info('Daily cron completed', $summary);
    } catch (\Throwable $e) {
        Logger::exception($e, 'DailyCronJob');
    }
});

/**
 * Frequent run (every 5 minutes on WHMCS 8): poll provider state for calls and
 * messages that are still in flight.
 */
add_hook('AfterCronJob', 1, static function ($vars) {
    try {
        $cron = new Cron();
        $cron->runFrequent();
    } catch (\Throwable $e) {
        Logger::exception($e, 'AfterCronJob');
    }
});

/**
 * Mark platform transactions as paid when their WHMCS invoice settles.
 */
add_hook('InvoicePaid', 1, static function ($vars) {
    try {
        $invoiceId = (int) ($vars['invoiceid'] ?? 0);
        if ($invoiceId <= 0) {
            return;
        }

        $usageService = new \PhoneServices\Services\UsageService();
        $updated = $usageService->markInvoicePaid($invoiceId);

        if ($updated > 0) {
            Logger::info('Phone service transactions settled', [
                'invoice'      => $invoiceId,
                'transactions' => $updated,
            ]);
        }
    } catch (\Throwable $e) {
        Logger::exception($e, 'InvoicePaid');
    }
});

/**
 * Suspend numbers and eSIMs when a client service is suspended.
 */
add_hook('AfterModuleSuspend', 1, static function ($vars) {
    try {
        $serviceId = (int) ($vars['params']['serviceid'] ?? 0);
        if ($serviceId <= 0) {
            return;
        }

        $numberService = new \PhoneServices\Services\NumberService();

        foreach (Database::select('mod_phoneservices_numbers', '*', ['assigned_service_id' => $serviceId, 'status' => 'active']) as $number) {
            $numberService->suspendNumber((int) $number['id'], 'WHMCS service suspended');
        }
    } catch (\Throwable $e) {
        Logger::exception($e, 'AfterModuleSuspend');
    }
});

/**
 * Re-activate numbers when the service is unsuspended.
 */
add_hook('AfterModuleUnsuspend', 1, static function ($vars) {
    try {
        $serviceId = (int) ($vars['params']['serviceid'] ?? 0);
        if ($serviceId <= 0) {
            return;
        }

        $numberService = new \PhoneServices\Services\NumberService();

        foreach (Database::select('mod_phoneservices_numbers', '*', ['assigned_service_id' => $serviceId, 'status' => 'suspended']) as $number) {
            $numberService->activateNumber((int) $number['id']);
        }
    } catch (\Throwable $e) {
        Logger::exception($e, 'AfterModuleUnsuspend');
    }
});

/**
 * Release provider resources when a service is terminated or deleted.
 */
add_hook('ServiceDelete', 1, static function ($vars) {
    try {
        $serviceId = (int) ($vars['serviceid'] ?? 0);
        if ($serviceId <= 0) {
            return;
        }

        $numberService = new \PhoneServices\Services\NumberService();
        $released = 0;

        foreach (Database::select('mod_phoneservices_numbers', '*', ['assigned_service_id' => $serviceId]) as $number) {
            if (in_array((string) $number['status'], ['released', 'expired'], true)) {
                continue;
            }
            $numberService->releaseNumber((int) $number['id']);
            $released++;
        }

        Database::update('mod_phoneservices_subscriptions', [
            'status'       => 'cancelled',
            'cancelled_at' => date('Y-m-d H:i:s'),
        ], ['service_id' => $serviceId]);

        Logger::info('Service teardown completed', ['service' => $serviceId, 'numbers_released' => $released]);
    } catch (\Throwable $e) {
        Logger::exception($e, 'ServiceDelete');
    }
});

/**
 * Inject client-area assets only on the module's own pages.
 */
add_hook('ClientAreaHeadOutput', 1, static function ($vars) {
    if (($_GET['m'] ?? '') !== 'phoneservices') {
        return '';
    }

    $base = '/modules/addons/phoneservices/assets';

    return '<link rel="stylesheet" href="' . $base . '/css/client.css?v=' . PHONESERVICES_VERSION . '">';
});

add_hook('ClientAreaFooterOutput', 1, static function ($vars) {
    if (($_GET['m'] ?? '') !== 'phoneservices') {
        return '';
    }

    $base = '/modules/addons/phoneservices/assets';
    $output = '';

    // The Twilio Voice SDK is only loaded on the VoIP page and only when the
    // configured voice provider actually supports browser calling.
    if (($_GET['action'] ?? '') === 'voip' && Config::isServiceEnabled('voip')) {
        $voiceProvider = Config::getProviderForCapability('voice');
        if (in_array('webrtc', ProviderRegistry::capabilities($voiceProvider), true)) {
            $output .= '<script src="https://sdk.twilio.com/js/voice/releases/2.11.1/twilio.min.js" crossorigin="anonymous"></script>';
        }
    }

    // Chart.js powers the analytics graph on the usage page only.
    if (($_GET['action'] ?? '') === 'usage' && Config::isServiceEnabled('analytics')) {
        $output .= '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" crossorigin="anonymous"></script>';
    }

    return $output . '<script src="' . $base . '/js/client/app.js?v=' . PHONESERVICES_VERSION . '"></script>';
});

/**
 * Admin assets for the Super Admin panel.
 */
add_hook('AdminAreaHeadOutput', 1, static function ($vars) {
    if (($_GET['module'] ?? '') !== 'phoneservices') {
        return '';
    }

    return '<link rel="stylesheet" href="../modules/addons/phoneservices/assets/css/admin.css?v=' . PHONESERVICES_VERSION . '">';
});

add_hook('AdminAreaFooterOutput', 1, static function ($vars) {
    if (($_GET['module'] ?? '') !== 'phoneservices') {
        return '';
    }

    return '<script src="../modules/addons/phoneservices/assets/js/admin/app.js?v=' . PHONESERVICES_VERSION . '"></script>';
});

/**
 * Surface phone services on the client-area home page.
 */
add_hook('ClientAreaPrimaryNavbar', 1, static function ($primaryNavbar) {
    try {
        if (!Config::getBool('show_navbar_link', true)) {
            return;
        }

        $services = $primaryNavbar->getChild('Services');
        if ($services === null) {
            return;
        }

        $services->addChild('Phone Services', [
            'label' => 'Phone Services',
            'uri'   => 'index.php?m=phoneservices',
            'order' => 90,
        ]);
    } catch (\Throwable $e) {
        // Navigation is cosmetic - never break the client area over it.
    }
});

/**
 * Record module upgrades.
 */
add_hook('AfterModuleUpgrade', 1, static function ($vars) {
    if (($vars['module'] ?? '') === 'phoneservices') {
        Logger::info('Module upgraded', ['version' => $vars['version'] ?? '']);
    }
});
