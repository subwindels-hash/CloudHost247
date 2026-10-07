<?php
/**
 * Dynamic robots.txt for the WHMCS/PHP deployment.
 *
 * The static `robots.txt` in the document root is valid crawl guidance but cannot contain a
 * correct `Sitemap:` line, because the robots.txt specification requires an **absolute URL** and
 * an absolute URL cannot be written without knowing the domain the site is served on.
 *
 * This endpoint therefore generates the file from two deployment facts:
 *
 *   1. the exclusion policy, read from the shared site registry through `CrawlPolicy` — the same
 *      policy the Node platform, the generated static file and the PHP sitemaps read, so the four
 *      surfaces cannot contradict each other;
 *   2. the deployment's configured SystemURL, for the absolute `Sitemap:` lines.
 *
 * Route `robots.txt` here with one rewrite rule (see `infrastructure/litespeed/webroot-hardening.htaccess`):
 *
 *     RewriteRule ^robots\.txt$ robots.php [L]
 *
 * If the rewrite is not configured, the static file is served and nothing breaks — the crawler
 * simply falls back to `/sitemap.xml`, which the site advertises from the homepage and the sitemaps
 * are still discovered through the cross-links between them.
 *
 * Note what is deliberately absent: a `Disallow` for any sitemap endpoint. Blocking a sitemap makes
 * it unfetchable, which would silently void the `Sitemap:` lines below. Those endpoints send
 * `X-Robots-Tag: noindex` instead.
 *
 * Crawl guidance only. This is not, and must never be treated as, an access control.
 */

require __DIR__ . '/init.php';

$theme = __DIR__ . '/modules/addons/cloudhost247_theme/lib';
if (is_file($theme . '/Site.php')) { require_once $theme . '/Site.php'; }
if (is_file($theme . '/CrawlPolicy.php')) { require_once $theme . '/CrawlPolicy.php'; }

header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: public, max-age=3600');
header('X-Content-Type-Options: nosniff');

$base = '';
try {
    $url = \WHMCS\Database\Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value');
    if (is_string($url) && preg_match('~^https?://[^/]+~', $url)) {
        $base = rtrim($url, '/');
    }
} catch (\Throwable $unavailable) {
    // Falls through to the relative-guidance branch below rather than emitting a wrong absolute URL.
}

$exclusions = class_exists('\CloudHost247\Theme\CrawlPolicy')
    ? \CloudHost247\Theme\CrawlPolicy::exclusions()
    : array('/admin/', '/modules/', '/cart.php', '/clientarea.php', '/register.php', '/pwreset.php', '/submitticket.php', '/site-search.php', '/errors/');

echo "# CloudHost247\n";
echo "# Generated from the shared site registry (sitemap.exclude / sitemap.excludePhp).\n";
echo "# Crawl guidance. Never an authorization mechanism: private areas are\n";
echo "# protected by authentication, not by this file.\n\n";
echo "User-agent: *\n";
foreach ($exclusions as $path) {
    echo 'Disallow: ' . $path . "\n";
}

echo "\n# Sitemaps. Absolute URLs are required by the specification; they are generated\n";
echo "# here from the configured SystemURL so this file is correct on every deployment.\n";
if ($base !== '') {
    foreach (\CloudHost247\Theme\CrawlPolicy::SITEMAP_ENDPOINTS as $endpoint) {
        // builder-sitemap.php answers 404 while the Website Builder addon is inactive; that is the
        // correct state for the endpoint, and a 404 sitemap is ignored rather than harmful.
        echo 'Sitemap: ' . $base . '/' . $endpoint . "\n";
    }
} else {
    // No URL is configured, so no absolute sitemap URL can be stated. Saying so is better than
    // emitting a relative directive that every crawler will ignore.
    echo "# SystemURL is not configured, so no absolute sitemap URL can be published.\n";
    echo "# Set it in WHMCS (Setup > General Settings) and this file will list the sitemaps.\n";
}
