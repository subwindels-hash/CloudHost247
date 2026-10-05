<?php
/** Public, bounded editorial search. No account records, draft bodies or credentials. */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/Site.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Search CloudHost247');
$query = isset($_GET['q']) && is_string($_GET['q']) ? trim(substr($_GET['q'], 0, 100)) : '';
$results = array();
$catalog = \CloudHost247\Theme\Site::catalog();
$published = array();
$unpublished = array();
try {
    require_once __DIR__ . '/modules/addons/cloudhost247_core/bootstrap.php';
    require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';
    $repository = new \CloudHost247\Theme\ThemeRepository();
    foreach ($repository->all('page') as $item) {
        if (!$item['published']) { $unpublished[$item['slug']] = true; }
    }
    foreach ($repository->published('page') as $item) { $published[$item['slug']] = $item; }
} catch (\Throwable $e) { /* Static route search remains available, no private data fallback. */ }
if ($query !== '') {
    foreach ($catalog['pages'] as $path => $page) {
        if (isset($unpublished[$page['slug']])) { continue; }
        $item = isset($published[$page['slug']]) ? $published[$page['slug']] : $page;
        $text = $item['title'] . ' ' . $item['summary'] . ' ' . (isset($item['body']) ? strip_tags($item['body']) : '');
        if (stripos($text, $query) === false) { continue; }
        $results[] = array('title' => $item['title'], 'summary' => $item['summary'], 'url' => $path, 'category' => $page['category']);
        if (count($results) >= 40) { break; }
    }
}
$ca->assign('chSearchQuery', $query);
$ca->assign('chSearchResults', $results);
$ca->setTemplate('cloudhost247-search');
$ca->output();
