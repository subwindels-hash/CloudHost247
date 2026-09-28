<?php
/**
 * CloudHost247 Tools - Class Autoloader
 *
 * @package    WHMCS
 * @author     CloudHost247 Tools Team
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

/**
 * Autoloader for CloudHost247 Tools classes
 */
spl_autoload_register(function ($class) {
    $prefix = 'WHMCS\\Module\\Addon\\CloudHost247Tools\\';
    
    // Check if the class uses our namespace
    if (strpos($class, $prefix) !== 0) {
        return;
    }
    
    // Get the relative class name
    $relativeClass = str_replace($prefix, '', $class);
    
    // Map class names to files
    $classMap = [
        'CacheManager'       => CLOUDHOST247_TOOLS_INCLUDES_DIR . '/CacheManager.php',
        'SecurityManager'    => CLOUDHOST247_TOOLS_INCLUDES_DIR . '/SecurityManager.php',
        'WhoisTool'          => CLOUDHOST247_TOOLS_INCLUDES_DIR . '/WhoisTool.php',
        'IpTool'             => CLOUDHOST247_TOOLS_INCLUDES_DIR . '/IpTool.php',
        'DnsTool'            => CLOUDHOST247_TOOLS_INCLUDES_DIR . '/DnsTool.php',
        'DomainAvailability' => CLOUDHOST247_TOOLS_INCLUDES_DIR . '/DomainAvailability.php',
        'AjaxHandler'        => CLOUDHOST247_TOOLS_INCLUDES_DIR . '/AjaxHandler.php',
        'WhatIsMyIPApi'      => CLOUDHOST247_TOOLS_API_DIR . '/WhatIsMyIPApi.php',
        'IPinfoApi'          => CLOUDHOST247_TOOLS_API_DIR . '/IPinfoApi.php',
        'IPWhoApi'           => CLOUDHOST247_TOOLS_API_DIR . '/IPWhoApi.php',
        'NativeWhois'        => CLOUDHOST247_TOOLS_API_DIR . '/NativeWhois.php',
    ];
    
    if (isset($classMap[$relativeClass]) && file_exists($classMap[$relativeClass])) {
        require_once $classMap[$relativeClass];
    }
});
