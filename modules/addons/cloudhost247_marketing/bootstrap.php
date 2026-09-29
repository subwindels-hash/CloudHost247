<?php
/** CloudHost247 Marketing (email campaigns) autoloader (PSR-4 style, no Composer dependency). */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

spl_autoload_register(function ($class) {
    $prefix = 'CloudHost247\\Marketing\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) { return; }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = __DIR__ . '/lib/' . $relative . '.php';
    if (is_file($file)) { require_once $file; }
});

// Foundation (guards/audit/migrations) and Integrations (credential vault,
// SMTP probe/client) are independent sibling addons this module depends on.
// Both ship in the same repository; require them defensively so a broken
// install order still produces a clear error instead of a fatal failure.
$foundationBootstrap = __DIR__ . '/../cloudhost247_core/bootstrap.php';
if (is_file($foundationBootstrap)) { require_once $foundationBootstrap; }
$integrationsBootstrap = __DIR__ . '/../cloudhost247_integrations/bootstrap.php';
if (is_file($integrationsBootstrap)) { require_once $integrationsBootstrap; }
