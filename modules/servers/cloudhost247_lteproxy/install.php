<?php

declare(strict_types=1);

/**
 * CloudHost247 Isc LTE Proxy Module - Installation Script
 *
 * Run this script to install the module properly.
 *
 * @package CloudHost247\LTEProxy
 * @version 1.0.0
 */

if (php_sapi_name() !== 'cli') {
    die("This script must be run from the command line.\n");
}

echo "========================================\n";
echo "CloudHost247 Isc LTE Proxy Module\n";
echo "Installation Script v1.0.0\n";
echo "========================================\n\n";

// Check PHP version
if (PHP_VERSION_ID < 80000) {
    echo "ERROR: PHP 8.0 or higher is required. Current version: " . PHP_VERSION . "\n";
    exit(1);
}

echo "[OK] PHP version: " . PHP_VERSION . "\n";

// Check required extensions
$required = ['curl', 'json', 'pdo', 'openssl'];
$missing = [];

foreach ($required as $ext) {
    if (!extension_loaded($ext)) {
        $missing[] = $ext;
    }
}

if (!empty($missing)) {
    echo "ERROR: Missing required PHP extensions: " . implode(', ', $missing) . "\n";
    exit(1);
}

echo "[OK] All required PHP extensions loaded\n";

// Determine WHMCS root path
$whmcsPath = dirname(__DIR__, 3); // From modules/servers/cloudhost247_lteproxy to WHMCS root
$modulePath = __DIR__;
$moduleName = basename($modulePath);

if (!is_dir($whmcsPath . '/vendor/whmcs')) {
    echo "WARNING: Could not detect WHMCS root at: $whmcsPath\n";
    echo "Please verify the module is placed in: /modules/servers/$moduleName/\n";
    echo "\nContinuing with setup...\n\n";
} else {
    echo "[OK] WHMCS detected at: $whmcsPath\n";
}

// Check directory structure
$requiredDirs = [
    'lib',
    'hooks',
    'ajax',
    'templates/admin',
    'templates/client',
    'assets/css',
    'assets/js',
    'lang',
];

echo "\nChecking directory structure...\n";

foreach ($requiredDirs as $dir) {
    $fullPath = $modulePath . '/' . $dir;
    if (!is_dir($fullPath)) {
        echo "[CREATE] Creating directory: $dir\n";
        mkdir($fullPath, 0755, true);
    } else {
        echo "[OK] Directory exists: $dir\n";
    }
}

// Create logs directory
$logsPath = $modulePath . '/logs';
if (!is_dir($logsPath)) {
    echo "[CREATE] Creating logs directory\n";
    mkdir($logsPath, 0755, true);
}

// Create cache directory
$cachePath = $modulePath . '/cache';
if (!is_dir($cachePath)) {
    echo "[CREATE] Creating cache directory\n";
    mkdir($cachePath, 0755, true);
}

// Check file permissions
echo "\nChecking file permissions...\n";

$writableDirs = ['logs', 'cache'];
foreach ($writableDirs as $dir) {
    $fullPath = $modulePath . '/' . $dir;
    if (!is_writable($fullPath)) {
        echo "[WARN] Directory not writable: $dir\n";
        echo "       Run: chmod 755 $fullPath\n";
    } else {
        echo "[OK] Writable: $dir\n";
    }
}

// Check main module file
$mainFile = $modulePath . '/cloudhost247_lteproxy.php';
if (!file_exists($mainFile)) {
    echo "\nERROR: Main module file not found: cloudhost247_lteproxy.php\n";
    exit(1);
}

echo "[OK] Main module file exists\n";

// Check core library files
$coreFiles = [
    'lib/ApiClient.php',
    'lib/ApiException.php',
    'lib/Logger.php',
    'lib/Cache.php',
    'lib/Helpers.php',
    'lib/RateLimiter.php',
];

echo "\nChecking core library files...\n";
foreach ($coreFiles as $file) {
    if (file_exists($modulePath . '/' . $file)) {
        echo "[OK] $file\n";
    } else {
        echo "[MISSING] $file\n";
    }
}

// Validate PHP syntax
echo "\nValidating PHP syntax...\n";

$phpFiles = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($modulePath, RecursiveDirectoryIterator::SKIP_DOTS)
);

$syntaxErrors = 0;
foreach ($phpFiles as $file) {
    if ($file->getExtension() !== 'php') continue;

    $output = [];
    $returnCode = 0;
    exec('php -l ' . escapeshellarg($file->getPathname()) . ' 2>&1', $output, $returnCode);

    if ($returnCode !== 0) {
        echo "[SYNTAX ERROR] " . $file->getFilename() . "\n";
        echo "  " . implode("\n  ", $output) . "\n";
        $syntaxErrors++;
    }
}

if ($syntaxErrors === 0) {
    echo "[OK] All PHP files have valid syntax\n";
} else {
    echo "\nWARNING: $syntaxErrors file(s) have syntax errors\n";
}

// Installation summary
echo "\n========================================\n";
echo "Installation Summary\n";
echo "========================================\n";
echo "Module:        CloudHost247 Isc LTE Proxy Module\n";
echo "Version:       1.0.0\n";
echo "Location:      $modulePath\n";
echo "PHP Version:   " . PHP_VERSION . "\n";
echo "\n";

echo "Next Steps:\n";
echo "1. Log in to WHMCS Admin\n";
echo "2. Go to Setup > Products/Services > Products/Services\n";
echo "3. Create a new product and select 'CloudHost247 LTE Proxy' as the module\n";
echo "4. Configure your API credentials in the module settings\n";
echo "5. Test the API connection\n";
echo "\n";

echo "For support, contact CloudHost247 Isc.\n";
echo "========================================\n";

exit(0);
