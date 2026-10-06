<?php
/** Public WHMCS adapter: no duplicated DNS/network business logic, no exposed API token. */
define('CLIENTAREA', true);
require dirname(__DIR__) . '/init.php';
require_once dirname(__DIR__) . '/modules/addons/cloudhost247_theme/lib/ToolsSite.php';
require_once dirname(__DIR__) . '/modules/addons/cloudhost247_theme/lib/Site.php';
require_once dirname(__DIR__) . '/modules/addons/cloudhost247_core/bootstrap.php';
require_once dirname(__DIR__) . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';
$base = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME']))), '/');
$path = parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '', PHP_URL_PATH);
$path = is_string($path) ? substr($path, strlen($base)) : '';
$page = \CloudHost247\Theme\ToolsSite::resolve($path);
if ($page && $page['path'] !== $path) { header('Location: ' . $base . $page['path'], true, 301); exit; }
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle($page ? $page['name'] : 'Tool not found');
$ca->addToBreadCrumb($base . '/tools', 'Tools');
$platform = '';
try {
    $settings = (new \CloudHost247\Theme\ThemeRepository())->settings();
    $platform = \CloudHost247\Theme\Site::platformPath(isset($settings['platform_base_path']) ? $settings['platform_base_path'] : '');
} catch (\Throwable $e) { /* The page reports unavailable, not fabricated lookup data. */ }
$ready = $page && $platform !== '' && is_file(dirname(__DIR__) . '/assets/cloudhost247-tools/tools.js');
if (!$page) { http_response_code(404); header('X-Robots-Tag: noindex'); }
elseif (!$ready) { http_response_code(503); header('Retry-After: 300'); header('X-Robots-Tag: noindex'); }
$ca->assign('cloudhost247ToolsPage', $page);
$ca->assign('chToolsReady', $ready);
$ca->assign('chToolsPlatform', $platform);
$ca->assign('chToolsBase', $base);
$ca->setTemplate('cloudhost247-tools');
$ca->output();
