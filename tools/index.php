<?php
/**
 * Public tools front controller.
 * Uses the WHMCS theme when this tree is deployed into WHMCS. Without init.php
 * it still renders the same tools HTML so the route is not a blank placeholder.
 */
require __DIR__ . '/lib/bootstrap.php';

use CloudHost247\Tools\Catalog;
use CloudHost247\Tools\View;

$root = dirname(__DIR__);
$base = rtrim(str_replace('\\', '/', dirname(isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/tools/index.php')), '/');
$base = rtrim(str_replace('\\', '/', dirname($base)), '/');
$request = parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/tools', PHP_URL_PATH);
$request = is_string($request) ? $request : '/tools';
$path = $base !== '' && strpos($request, $base) === 0 ? substr($request, strlen($base)) : $request;
if ($path === '' || $path === '/') {
    $path = '/tools';
}
$query = isset($_GET['q']) && is_string($_GET['q']) ? trim(substr($_GET['q'], 0, 80)) : '';
$page = Catalog::resolve($path);
$legacy = null;
if (!$page && is_file($root . '/modules/addons/cloudhost247_theme/lib/ToolsSite.php')) {
    require_once $root . '/modules/addons/cloudhost247_theme/lib/ToolsSite.php';
    $legacy = \CloudHost247\Theme\ToolsSite::resolve($path);
    if ($legacy && isset($legacy['path']) && $legacy['path'] !== $path) {
        header('Location: ' . $base . $legacy['path'], true, 301);
        exit;
    }
}

$whmcs = is_file($root . '/init.php');
if (!$page && !$legacy) {
    http_response_code(404);
    header('X-Robots-Tag: noindex');
}
if ($whmcs && $page) {
    define('CLIENTAREA', true);
    require $root . '/init.php';
    require_once $root . '/modules/addons/cloudhost247_theme/lib/Site.php';
    $ca = new \WHMCS\ClientArea();
    $ca->initPage();
    $document = isset($page['seoTitle']) ? preg_replace('/\s*\|\s*CloudHost247$/', '', $page['seoTitle']) : $page['name'];
    $ca->setPageTitle($document);
    $ca->addToBreadCrumb($base . '/tools', 'Tools');
    if (!empty($page['slug'])) {
        $ca->addToBreadCrumb($base . $page['path'], $page['name']);
    }
    $ca->assign('cloudhost247ToolsPage', array(
        'path' => $page['path'],
        'name' => $page['name'],
        'summary' => isset($page['summary']) ? $page['summary'] : '',
        'slug' => isset($page['slug']) ? $page['slug'] : '',
    ));
    $ca->assign('chToolsReady', true);
    $ca->assign('chToolsBase', $base);
    $ca->assign('chToolsHtml', View::fragment($page, $query, $base));
    $ca->setTemplate('cloudhost247-tools');
    $ca->output();
    return;
}

if (!$whmcs) {
    if (!$page) {
        $page = array('kind' => 'hub', 'path' => '/tools', 'name' => 'Tool not found', 'summary' => 'That tool is not in the CloudHost247 catalogue.', 'slug' => '');
    }
    header('Content-Type: text/html; charset=UTF-8');
    echo View::document($page, $query, $base === '' ? '' : $base);
    return;
}

define('CLIENTAREA', true);
require $root . '/init.php';
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle($legacy ? $legacy['name'] : 'Tool not found');
if ($legacy) {
    // The shared registry knows this tool, but this PHP shell has no implementation for it: it runs
    // in the platform application. Say that instead of showing an empty tool, keep it out of the
    // index, and let the page link to the application's own tool route.
    if (!headers_sent()) { header('X-Robots-Tag: noindex'); }
    $ca->assign('cloudhost247ToolsPage', array(
        'path' => $legacy['path'],
        'name' => isset($legacy['name']) ? $legacy['name'] : 'CloudHost247 tool',
        'summary' => isset($legacy['summary']) ? $legacy['summary'] : '',
        'slug' => isset($legacy['slug']) ? $legacy['slug'] : '',
        'unserved' => true,
    ));
    $ca->assign('chToolsPlatformUrl', isset($legacy['slug']) ? '/tools/' . rawurlencode($legacy['slug']) : '');
} else {
    $ca->assign('cloudhost247ToolsPage', null);
    $ca->assign('chToolsPlatformUrl', '');
}
$ca->assign('chToolsReady', false);
$ca->assign('chToolsHtml', '');
$ca->assign('chToolsBase', $base);
$ca->setTemplate('cloudhost247-tools');
$ca->output();
