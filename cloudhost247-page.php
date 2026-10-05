<?php
use WHMCS\ClientArea;

define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_core/bootstrap.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';

$ca = new ClientArea();
$ca->setPageTitle('CloudHost247');
$ca->initPage();
$slug = isset($_GET['slug']) && is_string($_GET['slug']) ? (string) $_GET['slug'] : '';
// Known public slugs have one canonical PHP route; preserve the generic route for CMS-only pages.
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/Site.php';
foreach (\CloudHost247\Theme\Site::catalog()['pages'] as $route => $definition) {
    if ($definition['slug'] === $slug) { header('Location: ' . $route, true, 301); exit; }
}
try { $page = (new \CloudHost247\Theme\ThemeRepository())->findPublishedPage($slug); }
catch (\Throwable $e) { $page = null; }
if (!$page) { http_response_code(404); $ca->setPageTitle('Page not found'); $page = array('title' => 'Page not found', 'seo_title' => '', 'summary' => '', 'body' => '<p>The requested page is unavailable.</p>', 'missing' => true); }
$ca->setPageTitle($page['seo_title'] ?: $page['title']);
$ca->assign('cloudhost247Page', $page);
$ca->setTemplate('cloudhost247-page');
$ca->output();
