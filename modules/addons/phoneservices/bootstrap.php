<?php
/**
 * Shared bootstrap for addon, REST and webhook entry points.
 */
if (!defined('PHONESERVICES_ROOT')) {
    define('PHONESERVICES_ROOT', __DIR__);
}

// Standalone endpoints must bootstrap WHMCS before touching sessions or Capsule.
if (!defined('WHMCS')) {
    $candidates = array(
        dirname(__DIR__, 3) . '/init.php',
        dirname(__DIR__, 3) . '/configuration.php',
    );
    foreach ($candidates as $candidate) {
        if (is_file($candidate) && basename($candidate) === 'init.php') {
            require_once $candidate;
            break;
        }
    }
}

$composer = __DIR__ . '/vendor/autoload.php';
if (is_file($composer)) {
    require_once $composer;
} else {
    // Keeps activation and diagnostics usable before composer install.
    spl_autoload_register(function ($class) {
        $prefix = 'PhoneServices\\';
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }
        $file = PHONESERVICES_ROOT . '/lib/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require_once $file;
        }
    });
}
