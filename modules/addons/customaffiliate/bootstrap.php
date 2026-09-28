<?php
/**
 * Custom Affiliate Commission - bootstrap / autoloader.
 *
 * Included exactly once by every entry point (addon module, hooks file, CLI
 * utility). No Composer dependency: a small PSR-4 autoloader maps the
 * CustomAffiliate namespace onto lib/, so a missing vendor directory can never
 * fatal a WHMCS installation.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

if (defined('CUSTOMAFFILIATE_ROOT')) {
    return;
}

define('CUSTOMAFFILIATE_ROOT', __DIR__);
define('CUSTOMAFFILIATE_VERSION', '2.0.0');
define('CUSTOMAFFILIATE_MODULE', 'customaffiliate');

spl_autoload_register(static function ($class) {
    $prefix = 'CustomAffiliate\\';
    $length = strlen($prefix);

    if (strncmp($class, $prefix, $length) !== 0) {
        return;
    }

    $relative = str_replace('\\', DIRECTORY_SEPARATOR, substr($class, $length));
    $file = CUSTOMAFFILIATE_ROOT . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . $relative . '.php';

    if (is_file($file)) {
        require_once $file;
    }
});
