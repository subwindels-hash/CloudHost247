<?php
/**
 * CloudHost247 Network & Developer Tools — autoloader bootstrap.
 *
 * Follows the loader convention used by the other CloudHost247 first-party
 * addons (see modules/addons/cloudhost247_cart_recovery/bootstrap.php): a small
 * PSR-4 style autoloader over lib/, plus the versioned migration classes. No
 * Composer dependency is introduced.
 *
 * Two existing first-party systems are reused rather than duplicated:
 *
 *  - cloudhost247_core        audit log, structured logging, redaction,
 *                             versioned MigrationRunner, AdminGuard, RBAC.
 *  - cloudhost247_integrations Super Admin API & Integrations centre: encrypted
 *                             credential vault, hardened cURL transport, SMTP
 *                             probe/client, provider registry.
 *
 * Both are optional at load time. When one is not installed the affected
 * capability reports CONFIGURATION_REQUIRED instead of the module failing.
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

$ch247ToolsRoot = dirname(__DIR__);
if (is_file($ch247ToolsRoot . '/cloudhost247_core/bootstrap.php')) {
    require_once $ch247ToolsRoot . '/cloudhost247_core/bootstrap.php';
}
if (is_file($ch247ToolsRoot . '/cloudhost247_integrations/bootstrap.php')) {
    require_once $ch247ToolsRoot . '/cloudhost247_integrations/bootstrap.php';
}

spl_autoload_register(function ($class) {
    $prefix = 'CloudHost247\\NetworkTools\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    if (strpos($relative, '..') !== false) {
        return;
    }
    $file = __DIR__ . '/lib/' . $relative . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});
