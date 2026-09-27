<?php

declare(strict_types=1);

/**
 * CloudHost247 LTE Proxy Admin Sidebar Hooks
 *
 * Adds custom sidebar entries for the LTE Proxy module in the admin area.
 *
 * @package CloudHost247\LTEProxy\Hooks
 * @version 1.0.0
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

/**
 * Add admin sidebar menu items
 */
add_hook('AdminAreaSidebar', 1, function () {
    $sidebar = new WHMCS\Module\Addon\Setting();

    $menuItem = [
        'name' => 'CloudHost247 LTE Proxy',
        'icon' => 'fa-wifi',
        'uri' => '#',
        'order' => 100,
        'children' => [
            [
                'name' => 'Dashboard',
                'icon' => 'fa-tachometer-alt',
                'uri' => 'addonmodules.php?module=cloudhost247_lteproxy&action=dashboard',
                'order' => 1,
            ],
            [
                'name' => 'Proxy Management',
                'icon' => 'fa-network-wired',
                'uri' => 'addonmodules.php?module=cloudhost247_lteproxy&action=proxies',
                'order' => 2,
            ],
            [
                'name' => 'Order Logs',
                'icon' => 'fa-list-alt',
                'uri' => 'addonmodules.php?module=cloudhost247_lteproxy&action=logs',
                'order' => 3,
            ],
            [
                'name' => 'API Logs',
                'icon' => 'fa-code',
                'uri' => 'addonmodules.php?module=cloudhost247_lteproxy&action=api_logs',
                'order' => 4,
            ],
            [
                'name' => 'Settings',
                'icon' => 'fa-cog',
                'uri' => 'addonmodules.php?module=cloudhost247_lteproxy&action=settings',
                'order' => 5,
            ],
        ],
    ];

    return $menuItem;
});

/**
 * Add client profile sidebar hook
 */
add_hook('AdminClientProfileTabFields', 1, function ($vars) {
    $clientId = $vars['userid'] ?? 0;

    if (empty($clientId)) {
        return [];
    }

    try {
        // Check if client has any LTE proxy services
        $serviceCount = Capsule::table('tblhosting')
            ->join('tblproducts', 'tblhosting.packageid', '=', 'tblproducts.id')
            ->where('tblhosting.userid', $clientId)
            ->where('tblproducts.servertype', 'cloudhost247_lteproxy')
            ->count();

        if ($serviceCount > 0) {
            return [
                'LTE Proxy Services' => '<a href="clientsservices.php?userid=' . $clientId . '&filter_module=cloudhost247_lteproxy" class="btn btn-info btn-sm"><i class="fa fa-wifi"></i> View ' . $serviceCount . ' Proxy Service(s)</a>',
            ];
        }
    } catch (\Exception $e) {
        // Silently fail
    }

    return [];
});

/**
 * Add admin area header output for LTE Proxy pages
 */
add_hook('AdminAreaHeaderOutput', 1, function ($vars) {
    $module = $_GET['module'] ?? '';

    if ($module !== 'cloudhost247_lteproxy') {
        return '';
    }

    $assetPath = 'modules/servers/cloudhost247_lteproxy/assets';

    return '<link rel="stylesheet" href="' . $assetPath . '/css/admin.css?v=1.0.0">';
});

/**
 * Add admin area footer output for LTE Proxy pages
 */
add_hook('AdminAreaFooterOutput', 1, function ($vars) {
    $module = $_GET['module'] ?? '';

    if ($module !== 'cloudhost247_lteproxy') {
        return '';
    }

    $assetPath = 'modules/servers/cloudhost247_lteproxy/assets';

    return '<script src="' . $assetPath . '/js/admin.js?v=1.0.0"></script>';
});
