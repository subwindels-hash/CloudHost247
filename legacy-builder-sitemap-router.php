<?php
/**
 * Preserved original Website Builder sitemap generator (was builder-sitemap.php).
 * Reached only through builder-sitemap.php, which loads init.php first.
 */

/**
 * XML sitemap for Website Builder pages.
 *
 * Lists only pages a search engine may legitimately index (public, live, not noindex,
 * not canonicalised elsewhere) -- see SitemapService. It is served only while the builder
 * addon is active; otherwise it is a 404, matching builder-page.php. The existing
 * cloudhost247-sitemap.php (Theme CMS pages) is unchanged; submit both to search engines.
 */

use CloudHost247\Builder\Services\SitemapService;
use WHMCS\Database\Capsule;

$moduleDirectory = __DIR__ . '/modules/addons/cloudhost247_builder';
$active = false;
if (is_file($moduleDirectory . '/bootstrap.php')) {
    try {
        $active = (bool) Capsule::table('tbladdonmodules')->where('module', 'cloudhost247_builder')->exists();
    } catch (\Throwable $unavailable) {
        $active = false;
    }
}
if (!$active) {
    http_response_code(404);
    exit;
}
require_once $moduleDirectory . '/bootstrap.php';

try {
    $systemUrl = (string) Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value');
    if (!preg_match('#^https?://#i', $systemUrl)) { throw new \RuntimeException('SystemURL is not configured.'); }
    $xml = (new SitemapService())->xml($systemUrl);
} catch (\Throwable $failure) {
    http_response_code(503);
    header('Retry-After: 300');
    exit;
}

header('Content-Type: application/xml; charset=UTF-8');
header('Cache-Control: public, max-age=900');
header('X-Robots-Tag: noindex');
echo $xml;

