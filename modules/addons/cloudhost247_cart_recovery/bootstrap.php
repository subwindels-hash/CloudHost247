<?php
if (!defined('WHMCS')) { die('Direct access denied'); }

spl_autoload_register(function ($class) {
    $prefix = 'CloudHost247\CartRecovery\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) return;
    $file = __DIR__ . '/lib/' . str_replace('\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) require_once $file;
});
require_once __DIR__ . '/migrations/V100.php';
