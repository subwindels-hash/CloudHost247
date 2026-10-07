<?php
/**
 * Tools sitemap. Uses the public catalogue only. No database and no secrets.
 *
 * Category URLs are the canonical discovery categories (the ones the menus publish and the
 * registry defines), not the catalogue's internal engine grouping — publishing both taxonomies
 * would hand crawlers nine URLs no navigation surface links to. Everything is filtered through
 * CrawlPolicy, the same policy robots.txt is generated from.
 */
$catalog = __DIR__ . '/modules/addons/cloudhost247_theme/resources/tools-public.json';
$theme = __DIR__ . '/modules/addons/cloudhost247_theme/lib';
if (is_file($theme . '/Site.php')) { require_once $theme . '/Site.php'; }
if (is_file($theme . '/CrawlPolicy.php')) { require_once $theme . '/CrawlPolicy.php'; }
$data = json_decode((string) file_get_contents($catalog), true);
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
$host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
if (!preg_match('/^[A-Za-z0-9.-]+(?::\d+)?$/', $host)) {
    $host = 'localhost';
}
$base = ($https ? 'https' : 'http') . '://' . $host;
header('Content-Type: application/xml; charset=UTF-8');
header('X-Robots-Tag: noindex');
echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
echo "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
$categories = array();
if (class_exists('\CloudHost247\Theme\CrawlPolicy')) {
    try {
        $catalog = \CloudHost247\Theme\Site::catalog();
        if (isset($catalog['toolCategories']) && is_array($catalog['toolCategories'])) {
            foreach ($catalog['toolCategories'] as $category) {
                if (!is_array($category)) { continue; }
                $slug = isset($category['slug']) ? (string) $category['slug'] : '';
                if ($slug === '' && isset($category['url'])) {
                    $path = preg_split('~[?#]~', (string) $category['url']);
                    $slug = substr($path[0], strrpos($path[0], '/') + 1);
                }
                if ($slug !== '') { $categories[$slug] = true; }
            }
        }
    } catch (\Throwable $unavailable) {
        $categories = array();
    }
}
if (!$categories) {
    // The registry resource is unreadable. Fall back to the discovery taxonomy as compiled, rather
    // than publishing the internal engine categories.
    foreach (array('dns-domains', 'ip-network', 'security', 'ssl', 'email', 'website', 'developer', 'calculators', 'utilities') as $slug) {
        $categories[$slug] = true;
    }
}
$paths = array('/tools');
foreach (array_keys($categories) as $slug) {
    $paths[] = '/tools/category/' . $slug;
}
if (is_array($data)) {
    foreach (isset($data['tools']) ? $data['tools'] : array() as $tool) {
        if (!empty($tool['enabled']) && !empty($tool['path'])) {
            $paths[] = $tool['path'];
        }
    }
}
if (class_exists('\CloudHost247\Theme\CrawlPolicy')) {
    $paths = \CloudHost247\Theme\CrawlPolicy::filter($paths);
}
foreach (array_unique($paths) as $path) {
    echo '<url><loc>' . htmlspecialchars($base . $path, ENT_XML1, 'UTF-8') . "</loc></url>\n";
}
echo "</urlset>\n";
