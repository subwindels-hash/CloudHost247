<?php
/** CloudHost247 independent foundation autoloader. */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

spl_autoload_register(function ($class) {
    $prefix = 'CloudHost247\\Foundation\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) { return; }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = __DIR__ . '/lib/' . $relative . '.php';
    if (is_file($file)) { require_once $file; }
});
