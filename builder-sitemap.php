<?php
/**
 * Website Builder sitemap.
 *
 * The builder runs on the retired WHMCS layer. This entry point checks that
 * the layer is actually present and answers a clean 404 when it is not, so
 * the URL never fatals on a plain web server. When the layer IS present the
 * original, unchanged builder logic runs from legacy-builder-sitemap-router.php.
 */

declare(strict_types=1);

$init = __DIR__ . '/init.php';
$moduleDirectory = __DIR__ . '/modules/addons/cloudhost247_builder';

if (!is_file($init) || !is_file($moduleDirectory . '/bootstrap.php')) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Not found');
}

require_once $init;
require __DIR__ . '/legacy-builder-sitemap-router.php';
