<?php
/**
 * Tools sitemap. Uses the public catalogue only. No database and no secrets.
 */
$catalog = __DIR__ . '/modules/addons/cloudhost247_theme/resources/tools-public.json';
$data = json_decode((string) file_get_contents($catalog), true);
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
$host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
if (!preg_match('/^[A-Za-z0-9.-]+(?::\d+)?$/', $host)) {
    $host = 'localhost';
}
$base = ($https ? 'https' : 'http') . '://' . $host;
header('Content-Type: application/xml; charset=UTF-8');
echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
echo "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
$paths = array('/tools');
if (is_array($data)) {
    foreach (array_keys(isset($data['categories']) ? $data['categories'] : array()) as $slug) {
        $paths[] = '/tools/category/' . $slug;
    }
    foreach (isset($data['tools']) ? $data['tools'] : array() as $tool) {
        if (!empty($tool['enabled']) && !empty($tool['path'])) {
            $paths[] = $tool['path'];
        }
    }
}
foreach (array_unique($paths) as $path) {
    echo '<url><loc>' . htmlspecialchars($base . $path, ENT_XML1, 'UTF-8') . "</loc></url>\n";
}
echo "</urlset>\n";
