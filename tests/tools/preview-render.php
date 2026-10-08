<?php
/**
 * Renders one Tools route to stdout for the preview server.
 *
 * Uses the same bootstrap, Catalog and View the WHMCS shell uses, so what the browser receives is
 * the page the site would serve.
 */
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require dirname(__DIR__, 2) . '/tools/lib/bootstrap.php';
use CloudHost247\Tools\Catalog;
use CloudHost247\Tools\View;

$path = isset($argv[1]) ? $argv[1] : '/tools';
$base = isset($argv[2]) ? $argv[2] : '';
$resolved = Catalog::resolve($path);
// A shell exit status is modulo 256, so a 404 cannot travel as the exit code. The status goes on
// the first stdout line instead and the server strips it.
if (!$resolved) {
    echo "STATUS 404\n";
    fwrite(STDERR, "no tool or collection at $path\n");
    exit(0);
}
echo "STATUS 200\n";
echo View::document($resolved, '', $base);
