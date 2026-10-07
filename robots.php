<?php
/**
 * Dynamic robots.txt for the WHMCS/PHP deployment.
 *
 * The static `robots.txt` in the document root is valid crawl guidance but cannot contain a
 * correct `Sitemap:` line, because the robots.txt specification requires an **absolute URL** and
 * an absolute URL cannot be written without knowing the domain the site is served on. The static
 * file's relative `Sitemap:` directives are therefore ignored by every crawler, which is a silent
 * failure: the sitemaps never get discovered and nobody notices.
 *
 * This endpoint generates the file from the deployment's own configuration, exactly as
 * `cloudhost247-sitemap.php` and the Node platform's `/robots.txt` do. Route `robots.txt` here
 * with one rewrite rule (documented in `infrastructure/litespeed/webroot-hardening.htaccess`):
 *
 *     RewriteRule ^robots\.txt$ robots.php [L]
 *
 * If the rewrite is not configured, the static file is served and nothing breaks — the crawler
 * simply falls back to `/sitemap.xml`, which the server does advertise from the homepage and from
 * the sitemap page.
 *
 * Crawl guidance only. This is not, and must never be treated as, an access control.
 */

require __DIR__ . '/init.php';

header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: public, max-age=3600');

$base = '';
try {
    $url = \WHMCS\Database\Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value');
    if (is_string($url) && preg_match('~^https?://[^/]+~', $url)) {
        $base = rtrim($url, '/');
    }
} catch (\Throwable $unavailable) {
    // Falls through to the relative-guidance branch below rather than emitting a wrong absolute URL.
}

$private = array(
    '/admin/',
    '/modules/',
    '/clientarea.php',
    '/cart.php',
    '/register.php',
    '/pwreset.php',
    '/site-search.php',
    '/service-error.php',
    '/errors/',
    '/cloudhost247-marketing-track.php',
    '/cloudhost247-sample.php',
    '/cloudhost247-vps-sample.php',
    '/all-element-cloudhost247.php',
    '/future-element.php',
    '/tables.php',
    '/cloudhost247-page.php',
);

echo "# CloudHost247\n";
echo "# Crawl guidance. Never an authorization mechanism: private areas are\n";
echo "# protected by authentication, not by this file.\n\n";
echo "User-agent: *\n";
foreach ($private as $path) {
    echo 'Disallow: ' . $path . "\n";
}

echo "\n# Sitemaps. Absolute URLs are required by the specification; they are generated\n";
echo "# here from the configured SystemURL so this file is correct on every deployment.\n";
if ($base !== '') {
    echo 'Sitemap: ' . $base . "/sitemap.xml\n";
    echo 'Sitemap: ' . $base . "/cloudhost247-sitemap.php\n";
    echo 'Sitemap: ' . $base . "/tools-sitemap.php\n";
    echo 'Sitemap: ' . $base . "/builder-sitemap.php\n";
} else {
    // No URL is configured, so no absolute sitemap URL can be stated. Saying so is better than
    // emitting a relative directive that every crawler will ignore.
    echo "# SystemURL is not configured, so no absolute sitemap URL can be published.\n";
    echo "# Set it in WHMCS (Setup > General Settings) and this file will list the sitemaps.\n";
}
