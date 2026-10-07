<?php
/**
 * Tools shell + navigation/footer verification (PHP CLI; no licensed WHMCS runtime required).
 *
 * Two separate contracts are checked here:
 *
 *   1. Every registered tool path (and its retained aliases) resolves to that tool, every category
 *      resolves, and unknown or traversal paths resolve to nothing.
 *   2. Every link the website actually publishes — the Tools mega menu groups and the footer Tools
 *      column — points at a destination that exists: a registered tool route, a registered category
 *      or a real first-party page. Placeholder destinations ('', '#', javascript:, example.com),
 *      absolute/off-site URLs, query strings and personal data are rejected outright, so the MRZ
 *      footer entry can never quietly become a broken or placeholder link.
 */
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/ToolsSite.php';
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/Site.php';
require dirname(__DIR__, 2) . '/tools/lib/bootstrap.php';
use CloudHost247\Theme\ToolsSite;
use CloudHost247\Theme\Site;
use CloudHost247\Tools\Catalog;

$count = 0;
function check($ok, $name) { global $count; $count++; if (!$ok) { fwrite(STDERR, "FAIL: $name\n"); exit(1); } }

foreach (ToolsSite::catalog()['tools'] as $tool) {
    foreach (array_merge(array($tool['path']), $tool['legacyPaths']) as $path) {
        check(ToolsSite::resolve($path)['slug'] === $tool['slug'], 'canonical and alias ' . $path);
    }
}
foreach (ToolsSite::catalog()['categories'] as $slug=>$label) { check(ToolsSite::resolve('/tools/category/'.$slug)['name']===$label.' Tools', 'category'); }
foreach (array('/tools/no-such-tool', '/tools/../../config.php', '/tools/%2e%2e/config.php') as $path) { check(ToolsSite::resolve($path)===null,'unknown/unsafe route'); }

// --- The MRZ tool is a first-class, reachable route in both registries --------------------------
$mrzUrl = 'tools/mrz-generator';
check(ToolsSite::resolve('/' . $mrzUrl) !== null && ToolsSite::resolve('/' . $mrzUrl)['slug'] === 'mrz-generator', 'MRZ route registered for the node/React shell');
check(Catalog::resolve('/' . $mrzUrl) !== null && Catalog::resolve('/' . $mrzUrl)['slug'] === 'mrz-generator', 'MRZ route registered for the PHP tools engine');
check(Catalog::resolve('/tools/mrz-generator')['mode'] === 'local', 'MRZ tool runs in the browser, not on the server');
check(!empty(Catalog::resolve('/tools/mrz-generator')['sensitive']), 'MRZ tool is flagged sensitive so the page shows the local-processing notice');
foreach (array('/tools/document/mrz', '/tools/document/mrz-parser', '/tools/mrz-parser') as $alias) {
    check(ToolsSite::resolve($alias) !== null && ToolsSite::resolve($alias)['slug'] === 'mrz-generator', 'retained MRZ URL ' . $alias);
}

// --- Published navigation and footer links must all resolve -------------------------------------
$catalog = Site::catalog();
$toolsGroup = null;
foreach ($catalog['navigation'] as $menu) {
    if (($menu['title'] ?? '') !== 'Tools') { continue; }
    $toolsGroup = $menu;
}
check($toolsGroup !== null, 'permanent Tools mega menu');
// The Tools panel is the one menu whose entries are partly live data, so the server-rendered
// floor is the registry's tool categories (`toolCategories`, rendered by site-nav.tpl) *plus* any
// statically declared groups. Both are published destinations and both are validated here; the
// live tools `site.js` appends from /api/tools/navigation are covered by the Node suite.
$menuLinks = array();
foreach ($catalog['toolCategories'] as $category) {
    $menuLinks[] = array(
        'label' => $category['label'] . ' Tools',
        'url' => ltrim((string) $category['url'], '/'),
    );
}
foreach ($toolsGroup['groups'] as $group) {
    foreach ($group['links'] as $link) { $menuLinks[] = $link; }
}
$footer = null;
foreach ($catalog['footer'] as $group) {
    if (($group['title'] ?? '') === 'Tools') { $footer = $group; }
}
check($footer !== null, 'permanent Tools footer column');
$footerLinks = $footer['links'];

$published = array(
    'Tools mega menu' => $menuLinks,
    'Tools footer' => $footerLinks,
);
foreach ($published as $surface => $links) {
    check(count($links) > 0, $surface . ' publishes at least one link');
    foreach ($links as $link) {
        $label = isset($link['label']) ? trim((string) $link['label']) : '';
        $url = isset($link['url']) ? trim((string) $link['url']) : '';
        check($label !== '', $surface . ' link label is not empty (' . $url . ')');
        check($url !== '' && $url !== '#' && strpos($url, '//') !== 0, $surface . ' has no placeholder destination: ' . $label);
        check(stripos($url, 'javascript:') === false && stripos($url, 'todo') === false && stripos($url, 'example.com') === false, $surface . ' has no stub destination: ' . $label);
        check(!preg_match('~^[a-z][a-z0-9+.-]*:~i', $url), $surface . ' stays on CloudHost247 (no absolute URL): ' . $label);
        check(strpos($url, '..') === false && strpos($url, '?') === false && strpos($url, '#') === false, $surface . ' link has no traversal, query string or fragment: ' . $label);
        // Personal data must never appear in a published link.
        check(!preg_match('~P<[A-Z]{3}[A-Z<]{5,}~', $url), $surface . ' link carries no machine-readable zone: ' . $label);
        if ($url === 'tools' || $url === 'tools/') { continue; }
        if (strpos($url, 'tools/category/') === 0) {
            // A published category must resolve on the surface a visitor lands on: the theme runtime
            // (`tools.json`, which the React Tools Center also discovers), or the PHP tools engine.
            $slug = substr($url, strlen('tools/category/'));
            $discovery = ToolsSite::catalog()['categories'];
            $engine = Catalog::categories();
            check(isset($discovery[$slug]) || isset($engine[$slug]), $surface . ' category link resolves: ' . $label);
            // The theme runtime must own it too, because that is what renders the page a visitor
            // reaches from the header and the footer. A link only the legacy engine knows would be
            // a dead end.
            check(isset($discovery[$slug]), $surface . ' category is served by the theme runtime: ' . $label);
            continue;
        }
        if (strpos($url, 'tools/') === 0) {
            check(ToolsSite::resolve('/' . $url) !== null || Catalog::resolve('/' . $url) !== null, $surface . ' tool link resolves: ' . $label . ' → ' . $url);
            continue;
        }
        // Every other destination is a first-party file in the repository (WHMCS entry points are
        // verified at deploy time by scripts/verify-website.py).
        check(is_file(dirname(__DIR__, 2) . '/' . $url) || in_array($url, array('index.php', 'cart.php', 'clientarea.php', 'contact.php', 'serverstatus.php', 'submitticket.php', 'knowledgebase.php'), true), $surface . ' page link exists: ' . $label);
    }
}

// --- The MRZ entry specifically, on both surfaces -----------------------------------------------
$mrzFooter = null;
foreach ($footerLinks as $link) {
    if (($link['url'] ?? '') === $mrzUrl) { $mrzFooter = $link; }
}
check($mrzFooter !== null, 'MRZ tool is published in the footer Tools column');
check($mrzFooter['label'] === 'MRZ Generator / MRZ Tools', 'MRZ footer link uses the agreed public label');
// The Tools panel is catalogue-driven: it publishes category floors server-side and appends the
// live catalogue (which includes MRZ, keyed by its category) when JavaScript runs. So the check
// that matters statically is that the menu publishes the category that owns MRZ — a visitor who
// opens Tools can reach it — while the direct link is pinned on the footer, which is static.
$mrzTool = null;
foreach (ToolsSite::catalog()['tools'] as $tool) {
    if ($tool['slug'] === 'mrz-generator') { $mrzTool = $tool; }
}
check($mrzTool !== null, 'MRZ tool is in the published Tools catalogue');
check($mrzTool['visibility'] === 'public' && $mrzTool['authRequired'] === false, 'MRZ tool is public and needs no account');
$mrzMenuReach = false;
foreach ($menuLinks as $link) {
    $url = (string) ($link['url'] ?? '');
    if ($url === $mrzUrl) { $mrzMenuReach = true; }
    if ($url === 'tools/category/' . $mrzTool['category']) { $mrzMenuReach = true; }
}
check($mrzMenuReach, 'MRZ tool is reachable from the Tools mega menu (its category is published)');
// The published URL must be the clean route: no document number, date of birth or query string.
check(preg_match('~^tools/mrz-generator$~', $mrzFooter['url']) === 1, 'MRZ footer URL is the clean canonical route');

// --- The published JSON must not contain anyone's personal data --------------------------------
foreach (array(
    'modules/addons/cloudhost247_theme/resources/site.json',
    'modules/addons/cloudhost247_theme/resources/tools-public.json',
    'modules/addons/cloudhost247_theme/resources/tools.json',
) as $resource) {
    $json = (string) file_get_contents(dirname(__DIR__, 2) . '/' . $resource);
    check(preg_match('~P<[A-Z]{3}[A-Z<]{5,}~', $json) !== 1, $resource . ' contains no machine-readable zone');
    check(stripos($json, 'passportnumber') === false && stripos($json, 'passport_number') === false, $resource . ' contains no passport number field');
}

// --- The XML sitemap lists the clean canonical route and nothing personal ------------------------
$_SERVER['HTTP_HOST'] = 'example.test';
$_SERVER['HTTPS'] = 'on';
ob_start();
include dirname(__DIR__, 2) . '/tools-sitemap.php';
$sitemap = (string) ob_get_clean();
check(strpos($sitemap, '/tools/mrz-generator</loc>') !== false, 'sitemap lists the canonical MRZ route');
check(preg_match('~P<[A-Z]{3}[A-Z<]{5,}~', $sitemap) !== 1, 'sitemap contains no machine-readable zone');
preg_match_all('~<loc>(.*?)</loc>~', $sitemap, $locations);
check(count($locations[1]) > 0, 'sitemap publishes locations');
foreach ($locations[1] as $location) {
    check(strpos($location, '?') === false && strpos($location, '#') === false, 'sitemap entry is a clean URL: ' . $location);
}

$context=Site::context(array('WEB_ROOT'=>'/billing', 'systemurl'=>'https://example.test/billing', 'cloudhost247ToolsPage'=>ToolsSite::resolve('/tools/dns-lookup')));
check($context['public']===true,'native public shell');
check($context['canonical']==='https://example.test/billing/tools/dns-lookup','subdirectory canonical');
check($context['title']==='DNS Lookup','specific metadata');
$mrzContext=Site::context(array('WEB_ROOT'=>'/billing', 'systemurl'=>'https://example.test/billing', 'cloudhost247ToolsPage'=>ToolsSite::resolve('/tools/mrz-generator')));
check($mrzContext['canonical']==='https://example.test/billing/tools/mrz-generator','MRZ canonical URL');
check($mrzContext['title']==='MRZ Generator / MRZ Tools','MRZ page metadata');
check(in_array('Tools',array_column(Site::catalog()['navigation'],'title'),true),'permanent Tools menu');
check(in_array('Tools',array_column(Site::catalog()['footer'],'title'),true),'permanent Tools footer');
echo "$count Tools shell, menu and footer assertions passed (PHP CLI; no licensed WHMCS runtime).\n";
