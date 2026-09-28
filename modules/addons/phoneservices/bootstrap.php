<?php
/**
 * Phone Services - bootstrap / autoloader.
 *
 * Every entry point (addon module, hooks, REST endpoint, webhooks, cron,
 * provisioning modules) includes this file exactly once. Composer is used when
 * the vendor directory is present; otherwise a PSR-4 fallback autoloader keeps
 * the module fully functional, because a missing `composer install` must never
 * fatal a WHMCS installation.
 *
 * @package PhoneServices
 */

if (defined('PHONESERVICES_ROOT')) {
    return;
}

define('PHONESERVICES_ROOT', __DIR__);
define('PHONESERVICES_VERSION', '1.1.0');

if (is_file(__DIR__ . '/vendor/autoload.php')) {
    require_once __DIR__ . '/vendor/autoload.php';
}

spl_autoload_register(static function ($class) {
    $prefix = 'PhoneServices\\';
    $length = strlen($prefix);

    if (strncmp($class, $prefix, $length) !== 0) {
        return;
    }

    $relative = str_replace('\\', DIRECTORY_SEPARATOR, substr($class, $length));
    $file = PHONESERVICES_ROOT . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . $relative . '.php';

    if (is_file($file)) {
        require_once $file;
    }
});
