<?php
/** CloudHost247 Digital Products Marketplace bootstrap/autoloader. */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

$foundationBootstrap = dirname(__DIR__) . '/cloudhost247_core/bootstrap.php';
if (is_file($foundationBootstrap)) {
    require_once $foundationBootstrap;
}

spl_autoload_register(function ($class) {
    $prefix = 'DigitalProducts\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) { return; }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = __DIR__ . '/lib/' . $relative . '.php';
    if (is_file($file)) { require_once $file; }
});
