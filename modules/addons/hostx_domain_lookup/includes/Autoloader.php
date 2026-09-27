<?php
/**
 * HostX Domain Lookup - Class Autoloader
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
 * Autoloader for HostX Domain Lookup classes
 */
spl_autoload_register(function ($class) {
    $prefix = 'WHMCS\\Module\\Addon\\HostXDomainLookup\\';
    
    // Check if the class uses our namespace
    if (strpos($class, $prefix) !== 0) {
        return;
    }
    
    // Get the relative class name
    $relativeClass = str_replace($prefix, '', $class);
    
    // Map class names to files
    $classMap = [
        'CacheManager'       => HOSTX_DOMAIN_LOOKUP_INCLUDES_DIR . '/CacheManager.php',
        'SecurityManager'    => HOSTX_DOMAIN_LOOKUP_INCLUDES_DIR . '/SecurityManager.php',
        'WhoisTool'          => HOSTX_DOMAIN_LOOKUP_INCLUDES_DIR . '/WhoisTool.php',
        'IpTool'             => HOSTX_DOMAIN_LOOKUP_INCLUDES_DIR . '/IpTool.php',
        'DnsTool'            => HOSTX_DOMAIN_LOOKUP_INCLUDES_DIR . '/DnsTool.php',
        'DomainAvailability' => HOSTX_DOMAIN_LOOKUP_INCLUDES_DIR . '/DomainAvailability.php',
        'AjaxHandler'        => HOSTX_DOMAIN_LOOKUP_INCLUDES_DIR . '/AjaxHandler.php',
        'WhatIsMyIPApi'      => HOSTX_DOMAIN_LOOKUP_API_DIR . '/WhatIsMyIPApi.php',
        'IPinfoApi'          => HOSTX_DOMAIN_LOOKUP_API_DIR . '/IPinfoApi.php',
        'IPWhoApi'           => HOSTX_DOMAIN_LOOKUP_API_DIR . '/IPWhoApi.php',
        'NativeWhois'        => HOSTX_DOMAIN_LOOKUP_API_DIR . '/NativeWhois.php',
    ];
    
    if (isset($classMap[$relativeClass]) && file_exists($classMap[$relativeClass])) {
        require_once $classMap[$relativeClass];
    }
});
