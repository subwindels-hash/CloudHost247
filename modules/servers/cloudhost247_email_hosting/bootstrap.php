<?php
/**
 * CloudHost247 Email Hosting - bootstrap and autoloader.
 *
 * Loaded by every entry point of the module (WHMCS module file, webhook
 * endpoint, cron runner, tests). No Composer dependency: a PSR-4 autoloader
 * maps the CloudHost247\Email namespace onto lib/, so a missing vendor directory can
 * never fatal a WHMCS installation.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

if (defined('CH247_EMAIL_ROOT')) {
    return;
}

define('CH247_EMAIL_ROOT', __DIR__);
define('CH247_EMAIL_MODULE', 'cloudhost247_email_hosting');
define('CH247_EMAIL_VERSION', '1.0.0');

spl_autoload_register(static function ($class) {
    $prefix = 'CloudHost247\\Email\\';
    $length = strlen($prefix);

    if (strncmp($class, $prefix, $length) !== 0) {
        return;
    }

    $relative = str_replace('\\', DIRECTORY_SEPARATOR, substr($class, $length));
    $file = CH247_EMAIL_ROOT . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . $relative . '.php';

    if (is_file($file)) {
        require_once $file;
    }
});
