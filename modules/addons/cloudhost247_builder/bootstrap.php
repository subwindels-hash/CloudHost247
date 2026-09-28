<?php
/** CloudHost247 Website Builder autoloader. */
if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

require_once __DIR__ . '/../cloudhost247_core/bootstrap.php';

// Optional: the API & Integrations centre supplies the credential vault and the
// real health data used by the service-status widget. Absent on deployments
// that have not enabled it, which the builder degrades around honestly.
if (is_file(__DIR__ . '/../cloudhost247_integrations/bootstrap.php')) {
    require_once __DIR__ . '/../cloudhost247_integrations/bootstrap.php';
}

spl_autoload_register(function ($class) {
    $prefix = 'CloudHost247\\Builder\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) { return; }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = __DIR__ . '/lib/' . $relative . '.php';
    if (is_file($file)) { require_once $file; }
});
