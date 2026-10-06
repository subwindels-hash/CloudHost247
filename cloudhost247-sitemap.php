<?php
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/Site.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicDiscovery.php';
header('Content-Type: application/xml; charset=UTF-8');
$urls = array();
try {
    $base = rtrim((string) \WHMCS\Database\Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value'), '/');
    if (!preg_match('~^https?://[^/]+~', $base)) { throw new \RuntimeException('System URL unavailable'); }
    $repo = new \CloudHost247\Theme\ThemeRepository();
    $pages = \CloudHost247\Theme\PublicDiscovery::pages($repo);
    foreach (\CloudHost247\Theme\PublicDiscovery::sitemapPaths($pages) as $path) {
        $urls[] = $base . '/' . $path;
    }
} catch (\Throwable $e) { http_response_code(503); header('Retry-After: 300'); header('Cache-Control: no-store'); $urls = array(); }
echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
foreach (array_unique($urls) as $url) { echo '<url><loc>' . htmlspecialchars($url, ENT_XML1, 'UTF-8') . "</loc></url>\n"; }
echo "</urlset>\n";
