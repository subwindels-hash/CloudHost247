<?php
/**
 * Sitemap of published theme/website pages.
 *
 * Publication rules live in PublicDiscovery (what is published) and CrawlPolicy (what a crawler may
 * index). The policy is applied here as well as in robots.txt, so this file can never advertise a
 * URL that robots.txt disallows — the failure mode where a sitemap lists cart.php and every
 * search-console report fills with "Submitted URL blocked by robots.txt".
 */
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/Site.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/CrawlPolicy.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicDiscovery.php';
header('Content-Type: application/xml; charset=UTF-8');
// Fetched by crawlers (robots.txt must be able to point here) but never indexed as a page itself.
header('X-Robots-Tag: noindex');
$urls = array();
try {
    $base = rtrim((string) \WHMCS\Database\Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value'), '/');
    if (!preg_match('~^https?://[^/]+~', $base)) { throw new \RuntimeException('System URL unavailable'); }
    $repo = new \CloudHost247\Theme\ThemeRepository();
    $pages = \CloudHost247\Theme\PublicDiscovery::pages($repo);
    foreach (\CloudHost247\Theme\CrawlPolicy::filter(\CloudHost247\Theme\PublicDiscovery::sitemapPaths($pages)) as $path) {
        $urls[] = $base . '/' . $path;
    }
} catch (\Throwable $e) { http_response_code(503); header('Retry-After: 300'); header('Cache-Control: no-store'); $urls = array(); }
echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
foreach (array_unique($urls) as $url) { echo '<url><loc>' . htmlspecialchars($url, ENT_XML1, 'UTF-8') . "</loc></url>\n"; }
echo "</urlset>\n";
