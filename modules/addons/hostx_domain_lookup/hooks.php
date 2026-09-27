<?php
/**
 * HostX Tools - Hooks
 *
 * Integrates with HostX theme v2.2.6 via WHMCS hooks.
 * Adds tools navigation and handles template modifications.
 *
 * @package    WHMCS
 * @author     HostX Tools Team
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 */

use WHMCS\Module\Addon\HostXTools\AjaxHandler;
use WHMCS\Module\Addon\HostXTools\SecurityManager;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

/**
 * Add HostX Tools to client area navigation
 */
add_hook('ClientAreaPrimaryNavbar', 1, function ($menu) {
    $config = hostx_domain_lookup_hook_get_config();
    
    // Check if any tool is enabled
    $anyEnabled = false;
    foreach (['enable_domain_whois', 'enable_ip_whois', 'enable_dns_lookup', 'enable_availability'] as $key) {
        if (!empty($config[$key]) && $config[$key] === 'on') {
            $anyEnabled = true;
            break;
        }
    }
    
    if (!$anyEnabled) {
        return;
    }
    
    // Add to primary navbar
    if (is_object($menu) && method_exists($menu, 'getChild')) {
        $toolsItem = $menu->addChild('HostX Tools', [
            'uri' => 'index.php?m=hostx_domain_lookup',
            'icon' => 'fa fa-wrench',
            'order' => 99,
        ]);
        
        if ($toolsItem && is_object($toolsItem) && method_exists($toolsItem, 'addChild')) {
            if (!empty($config['enable_domain_whois']) && $config['enable_domain_whois'] === 'on') {
                $toolsItem->addChild('Domain WHOIS', [
                    'uri' => 'index.php?m=hostx_domain_lookup&page=tool&tool=domain_whois',
                    'icon' => 'fa fa-globe',
                ]);
            }
            
            if (!empty($config['enable_ip_whois']) && $config['enable_ip_whois'] === 'on') {
                $toolsItem->addChild('IP Lookup', [
                    'uri' => 'index.php?m=hostx_domain_lookup&page=tool&tool=ip_whois',
                    'icon' => 'fa fa-map-marker',
                ]);
            }
            
            if (!empty($config['enable_dns_lookup']) && $config['enable_dns_lookup'] === 'on') {
                $toolsItem->addChild('DNS Lookup', [
                    'uri' => 'index.php?m=hostx_domain_lookup&page=tool&tool=dns_lookup',
                    'icon' => 'fa fa-server',
                ]);
            }
            
            if (!empty($config['enable_availability']) && $config['enable_availability'] === 'on') {
                $toolsItem->addChild('Domain Availability', [
                    'uri' => 'index.php?m=hostx_domain_lookup&page=tool&tool=availability',
                    'icon' => 'fa fa-search',
                ]);
            }
        }
    }
});

/**
 * Handle AJAX requests for tools
 */
add_hook('ClientAreaPage', 1, function ($vars) {
    // Check if this is an AJAX request for our module
    if (isset($_REQUEST['m']) && $_REQUEST['m'] === 'hostx_domain_lookup' && isset($_REQUEST['ajax'])) {
        header('Content-Type: application/json');
        
        $handler = new AjaxHandler();
        echo $handler->handle();
        exit;
    }
    
    return $vars;
});

/**
 * Add HostX Tools page to template vars
 */
add_hook('ClientAreaPage', 1, function ($vars) {
    if (isset($vars['m']) && $vars['m'] === 'hostx_domain_lookup') {
        // Ensure CSRF token is available
        $vars['hostxToolsCsrf'] = SecurityManager::generateCsrfToken();
        $vars['hostxToolsPath'] = 'modules/addons/hostx_domain_lookup';
        
        return $vars;
    }
});

/**
 * Add styles and scripts for HostX Tools
 */
add_hook('ClientAreaHeadOutput', 1, function ($vars) {
    // Only add assets on our module pages
    $currentPage = $_GET['m'] ?? '';
    
    if ($currentPage !== 'hostx_domain_lookup') {
        return '';
    }
    
    $modulePath = 'modules/addons/hostx_domain_lookup';
    
    $output = '';
    
    // CSS
    $output .= '<link rel="stylesheet" href="' . $modulePath . '/assets/css/hostx-tools.css?v=' . HOSTX_TOOLS_VERSION . '">' . PHP_EOL;
    
    // JavaScript
    $output .= '<script src="' . $modulePath . '/assets/js/hostx-tools.js?v=' . HOSTX_TOOLS_VERSION . '"></script>' . PHP_EOL;
    
    return $output;
});

/**
 * Helper: Get module configuration
 *
 * @return array
 */
function hostx_domain_lookup_hook_get_config()
{
    $settings = [];
    
    try {
        $result = Capsule::table('tbladdonmodules')
            ->where('module', 'hostx_domain_lookup')
            ->get();
        
        foreach ($result as $row) {
            $settings[$row->setting] = $row->value;
        }
    } catch (Exception $e) {
        // Use defaults
    }
    
    return $settings;
}
