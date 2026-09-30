<?php
/**
 * CloudHost247 Cart Recovery — autoloader bootstrap.
 *
 * Mirrors the loader convention used by the other CloudHost247 addons
 * (see modules/addons/cloudhost247_marketing/bootstrap.php): a tiny PSR-4
 * style autoloader over lib/, plus the versioned migration classes. No
 * Composer dependency is introduced and no existing utility is duplicated.
 */

if (!defined('WHMCS')) {
    die('Direct access denied');
}

spl_autoload_register(function ($class) {
    $prefix = 'CloudHost247\\CartRecovery\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    if (strncmp($relative, 'Migrations\\', 11) === 0) {
        $file = __DIR__ . '/migrations/' . str_replace('\\', '/', substr($relative, 11)) . '.php';
    } else {
        $file = __DIR__ . '/lib/' . str_replace('\\', '/', $relative) . '.php';
    }
    if (is_file($file)) {
        require_once $file;
    }
});
