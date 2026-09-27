<?php
/**
 * Phone Services - WHMCS Hooks
 * Integrates with WHMCS core events
 */

use PhoneServices\Core\Logger;
use PhoneServices\Services\NumberService;
use PhoneServices\Services\EsimService;
use PhoneServices\Services\UsageService;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/vendor/autoload.php';

/**
 * Daily Cron Job Hook
 * Handles renewals, expirations, cleanup
 */
add_hook('DailyCronJob', 1, function($vars) {
    try {
        // Number renewals
        $numberService = new NumberService();
        $renewalDue = $numberService->getRenewalDueNumbers(3);
        foreach ($renewalDue as $number) {
            // Send renewal reminder or auto-renew logic here
            Logger::info('Number renewal due', ['id' => $number['id'], 'user' => $number['user_id']]);
        }
        
        // eSIM expirations
        $esimService = new EsimService();
        $expiringEsims = $esimService->getExpiringEsims(3);
        foreach ($expiringEsims as $esim) {
            Logger::info('eSIM expiring soon', ['id' => $esim['id'], 'user' => $esim['user_id']]);
        }
        
        // Cleanup old logs
        $usageService = new UsageService();
        $usageService->cleanupOldUsage(365);
        Logger::cleanOldLogs();
        
        // Generate daily report
        $usageService->generateDailyReport();
        
    } catch (\Exception $e) {
        Logger::error('Cron hook error: ' . $e->getMessage());
    }
});

/**
 * Invoice Paid Hook
 * Process service provisioning on invoice payment
 */
add_hook('InvoicePaid', 1, function($vars) {
    try {
        $invoiceId = $vars['invoiceid'];
        
        // Check if this invoice is related to phone services
        $items = select_query('tblinvoiceitems', '*', ['invoiceid' => $invoiceId]);
        while ($item = mysql_fetch_assoc($items)) {
            if (strpos($item['description'], 'Phone Number') !== false 
                || strpos($item['description'], 'eSIM') !== false
                || strpos($item['description'], 'VoIP') !== false) {
                
                Logger::info('Phone service invoice paid', ['invoice' => $invoiceId, 'item' => $item['id']]);
                
                // Update transaction status
                $usageService = new UsageService();
                $usageService->updateTransactionStatus(0, 'completed', [
                    'invoice_id' => $invoiceId,
                    'gateway' => 'whmcs',
                ]);
            }
        }
    } catch (\Exception $e) {
        Logger::error('InvoicePaid hook error: ' . $e->getMessage());
    }
});

/**
 * Client Area Page Output Hook
 * Inject client area assets
 */
add_hook('ClientAreaPageOutput', 1, function($vars) {
    if (isset($_GET['m']) && $_GET['m'] === 'phoneservices') {
        $assets = '<link rel="stylesheet" href="/modules/addons/phoneservices/assets/css/client.css">';
        $assets .= '<script src="/modules/addons/phoneservices/assets/js/client/app.js"></script>';
        return $assets;
    }
});

/**
 * Admin Area Page Output Hook
 * Inject admin assets
 */
add_hook('AdminAreaPageOutput', 1, function($vars) {
    if (isset($_GET['module']) && $_GET['module'] === 'phoneservices') {
        $assets = '<link rel="stylesheet" href="/modules/addons/phoneservices/assets/css/admin.css">';
        $assets .= '<script src="/modules/addons/phoneservices/assets/js/admin/app.js"></script>';
        return $assets;
    }
});

/**
 * After Module Upgrade Hook
 */
add_hook('AfterModuleUpgrade', 1, function($vars) {
    if ($vars['module'] === 'phoneservices') {
        Logger::info('Module upgraded', ['version' => $vars['version']]);
    }
});

/**
 * Client Edit Hook
 * Track client profile changes
 */
add_hook('ClientEdit', 1, function($vars) {
    // Update phone numbers if client phone changed
    Logger::debug('Client edited', ['client' => $vars['userid']]);
});

/**
 * Pre-termination hook for services
 * Clean up numbers and eSIMs when service is terminated
 */
add_hook('ServiceDelete', 1, function($vars) {
    try {
        $serviceId = $vars['serviceid'];
        $userId = $vars['userid'];
        
        // Release associated numbers
        $numberService = new NumberService();
        $numbers = Database::select('mod_phoneservices_numbers', '*', ['assigned_service_id' => $serviceId]);
        foreach ($numbers as $number) {
            $numberService->releaseNumber($number['id']);
        }
        
        Logger::info('Service cleanup completed', ['service' => $serviceId, 'user' => $userId]);
    } catch (\Exception $e) {
        Logger::error('ServiceDelete hook error: ' . $e->getMessage());
    }
});
