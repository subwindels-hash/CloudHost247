<?php
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/Site.php';
header('Content-Type: application/xml; charset=UTF-8');
$urls = array();
try {
    $base = rtrim((string) \WHMCS\Database\Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value'), '/');
    if (!preg_match('~^https?://[^/]+~', $base)) { throw new \RuntimeException('System URL unavailable'); }
    $repo = new \CloudHost247\Theme\ThemeRepository();
    $catalog = \CloudHost247\Theme\Site::catalog();
    $known = array();
    $excluded = array();
    foreach ($repo->all() as $item) {
        if (!in_array($item['content_type'], array('page', 'landing'), true)) { continue; }
        if (!$item['published'] || (isset($item['sitemap']) && !$item['sitemap'])) { $excluded[$item['slug']] = true; }
    }
    $urls[] = $base . '/';
    foreach ($catalog['pages'] as $path => $page) {
        $known[$page['slug']] = $path;
        if (isset($excluded[$page['slug']])) { continue; }
        // Legal routes using CMS require actual published terms; do not index empty pages.
        if (in_array($path, array('terms-of-service.php', 'legal-notice.php', 'data-protection-standards.php'), true) && !$repo->findPublishedPage($page['slug'])) { continue; }
        $urls[] = $base . '/' . $path;
    }
    foreach (array_merge($repo->published('page'), $repo->published('landing')) as $page) {
        if (isset($excluded[$page['slug']]) || isset($known[$page['slug']])) { continue; }
        $urls[] = $base . '/cloudhost247-page.php?slug=' . rawurlencode($page['slug']);
    }
} catch (\Throwable $e) { http_response_code(503); header('Retry-After: 300'); $urls = array(); }
echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
foreach (array_unique($urls) as $url) { echo '<url><loc>' . htmlspecialchars($url, ENT_XML1, 'UTF-8') . "</loc></url>\n"; }
echo "</urlset>\n";
