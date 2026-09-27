<?php
/**
 * HostX Tools - Class Autoloader
 *
 * @package    WHMCS
 * @author     HostX Tools Team
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

/**
 * Autoloader for HostX Tools classes
 */
spl_autoload_register(function ($class) {
    $prefix = 'WHMCS\\Module\\Addon\\HostXTools\\';
    
    // Check if the class uses our namespace
    if (strpos($class, $prefix) !== 0) {
        return;
    }
    
    // Get the relative class name
    $relativeClass = str_replace($prefix, '', $class);
    
    // Map class names to files
    $classMap = [
        'CacheManager'       => HOSTX_TOOLS_INCLUDES_DIR . '/CacheManager.php',
        'SecurityManager'    => HOSTX_TOOLS_INCLUDES_DIR . '/SecurityManager.php',
        'WhoisTool'          => HOSTX_TOOLS_INCLUDES_DIR . '/WhoisTool.php',
        'IpTool'             => HOSTX_TOOLS_INCLUDES_DIR . '/IpTool.php',
        'DnsTool'            => HOSTX_TOOLS_INCLUDES_DIR . '/DnsTool.php',
        'DomainAvailability' => HOSTX_TOOLS_INCLUDES_DIR . '/DomainAvailability.php',
        'AjaxHandler'        => HOSTX_TOOLS_INCLUDES_DIR . '/AjaxHandler.php',
        'WhatIsMyIPApi'      => HOSTX_TOOLS_API_DIR . '/WhatIsMyIPApi.php',
        'IPinfoApi'          => HOSTX_TOOLS_API_DIR . '/IPinfoApi.php',
        'IPWhoApi'           => HOSTX_TOOLS_API_DIR . '/IPWhoApi.php',
        'NativeWhois'        => HOSTX_TOOLS_API_DIR . '/NativeWhois.php',
    ];
    
    if (isset($classMap[$relativeClass]) && file_exists($classMap[$relativeClass])) {
        require_once $classMap[$relativeClass];
    }
});
