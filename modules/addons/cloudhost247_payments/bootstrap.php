<?php
/** CloudHost247 Payments autoloader. */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

require_once __DIR__ . '/../cloudhost247_core/bootstrap.php';

spl_autoload_register(function ($class) {
    $prefix = 'CloudHost247\\Payments\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) { return; }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = __DIR__ . '/lib/' . $relative . '.php';
    if (is_file($file)) { require_once $file; }
});
