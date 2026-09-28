<?php
/**
 * hostx_email - bootstrap and autoloader.
 *
 * Loaded by every entry point of the module (WHMCS module file, webhook
 * endpoint, cron runner, tests). No Composer dependency: a PSR-4 autoloader
 * maps the HostxEmail namespace onto lib/, so a missing vendor directory can
 * never fatal a WHMCS installation.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

if (defined('HOSTX_EMAIL_ROOT')) {
    return;
}

define('HOSTX_EMAIL_ROOT', __DIR__);
define('HOSTX_EMAIL_MODULE', 'hostx_email');
define('HOSTX_EMAIL_VERSION', '1.0.0');

spl_autoload_register(static function ($class) {
    $prefix = 'HostxEmail\\';
    $length = strlen($prefix);

    if (strncmp($class, $prefix, $length) !== 0) {
        return;
    }

    $relative = str_replace('\\', DIRECTORY_SEPARATOR, substr($class, $length));
    $file = HOSTX_EMAIL_ROOT . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . $relative . '.php';

    if (is_file($file)) {
        require_once $file;
    }
});
