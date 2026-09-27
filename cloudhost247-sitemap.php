<?php
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';
header('Content-Type: application/xml; charset=UTF-8');
$base = rtrim((string) \WHMCS\Database\Capsule::table('tblconfiguration')->where('setting','SystemURL')->value('value'), '/');
$pages = array();
try { $pages = (new \CloudHost247\Theme\ThemeRepository())->published('page'); } catch (\Throwable $e) { http_response_code(503); }
echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
echo '<url><loc>' . htmlspecialchars($base . '/', ENT_XML1, 'UTF-8') . "</loc></url>\n";
foreach ($pages as $page) echo '<url><loc>' . htmlspecialchars($base . '/cloudhost247-page.php?slug=' . rawurlencode($page['slug']), ENT_XML1, 'UTF-8') . "</loc></url>\n";
echo "</urlset>\n";
