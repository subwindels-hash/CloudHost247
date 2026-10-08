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
use CloudHost247\Tools\View;

$count = 0;
function check($ok, $name) { global $count; $count++; if (!$ok) { fwrite(STDERR, "FAIL: $name\n"); exit(1); } }

foreach (ToolsSite::catalog()['tools'] as $tool) {
    foreach (array_merge(array($tool['path']), $tool['legacyPaths']) as $path) {
        check(ToolsSite::resolve($path)['slug'] === $tool['slug'], 'canonical and alias ' . $path);
    }
}
foreach (ToolsSite::catalog()['categories'] as $slug=>$label) { check(ToolsSite::resolve('/tools/category/'.$slug)['name']===$label.' Tools', 'category'); }

// --- No catalogue entry may exist without a page -------------------------------------------------
// "A catalogue tool without a usable page" is an acceptance failure, and it is not detectable by
// resolving the route: `Catalog::resolve()` reads the same array the catalogue does, so a tool that
// was added to `config/tools.php` but never renderable resolves perfectly happily. The page is
// therefore *rendered* here, exactly as the WHMCS shell renders it, and the result is inspected. A
// missing renderer, a broken template or an undefined field surfaces as a fatal, a warning or an
// empty document rather than as a 404.
$pageFailures = array();
foreach (Catalog::enabledTools() as $renderTool) {
    $resolvedTool = Catalog::resolve('/tools/' . $renderTool['slug']);
    $html = '';
    try {
        ob_start();
        $html = View::document($resolvedTool, '', '');
        ob_end_clean();
    } catch (\Throwable $error) {
        if (ob_get_level() > 0) { ob_end_clean(); }
        $pageFailures[] = $renderTool['slug'] . ' threw ' . get_class($error) . ': ' . $error->getMessage();
        continue;
    }
    if (stripos($html, '<h1') === false) { $pageFailures[] = $renderTool['slug'] . ' rendered no heading'; }
    if (preg_match('~Fatal error|Warning:|Notice:|Undefined (index|array key)~i', $html) === 1) {
        $pageFailures[] = $renderTool['slug'] . ' rendered a PHP diagnostic';
    }
}
check($pageFailures === array(), 'every enabled tool renders a page (' . count(Catalog::enabledTools()) . ' rendered): ' . implode(' | ', array_slice($pageFailures, 0, 4)));
check(count(Catalog::enabledTools()) >= 100, 'every catalogue tool is rendered, not vacuously passing');
// Categories are pages too, and a category with no tools behind it renders an empty catalogue.
foreach (array_keys(Catalog::categories()) as $nativeCategory) {
    check(Catalog::resolve('/tools/category/' . $nativeCategory) !== null, 'native category has a page: ' . $nativeCategory);
}

// --- One URL per capability. The native catalogue serves the interactive page; the shared registry
// describes the same tools for the app, the navigation and the sitemaps. When the two disagree on a
// path the capability is published twice: two indexable pages with one title, and the second one
// has no implementation behind it. Names are compared, not slugs, because the registries slug the
// same tool differently on purpose. The old registry paths stay declared as aliases, so the route
// still resolves and can redirect instead of turning into a 404.
$nativePathByName = array();
$normalise = function ($name) {
    // Compare by words, not by punctuation: `IP → Hostname` in the registry and `IP to Hostname`
    // in the native catalogue are one capability, and a character-level strip turns them into two
    // keys (`iphostname` / `iptohostname`) — which is how this pair stayed unnoticed.
    $words = preg_split('/[^a-z0-9]+/', strtolower((string) $name), -1, PREG_SPLIT_NO_EMPTY);
    $words = array_diff($words, array('to', 'my', 'the', 'a', 'an', 'of'));
    return implode('', $words);
};
foreach (Catalog::tools() as $native) {
    $nativePathByName[$normalise($native['name'])] = '/tools/' . $native['slug'];
}
$registryPaths = array();
$registryKnownNative = 0;
foreach (ToolsSite::catalog()['tools'] as $tool) {
    $registryPaths[] = $tool['path'];
    $key = $normalise($tool['name']);
    if (isset($nativePathByName[$key])) {
        $registryKnownNative++;
        check($tool['path'] === $nativePathByName[$key], 'one published path for ' . $tool['name'] . ': ' . $tool['path']);
    }
}
check($registryKnownNative >= 30, 'the registry is compared against the served catalogue, not vacuously (' . $registryKnownNative . ' capabilities matched)');
check(count($registryPaths) === count(array_unique($registryPaths)), 'the shared registry publishes each tool path once');

// --- The registry never re-labels a path the PHP catalogue already serves. When it does, one
// capability is published twice: the app and the sitemaps link the projection's path, which this
// surface can only answer with a noindex signpost, while the interactive page sits at the native
// path. Comparing names cannot see it (the two registries name and slug tools differently), so the
// check runs on the URLs the front controller resolves.
$relabelled = array();
$registryResolved = 0;
foreach (Catalog::enabledTools() as $native) {
    $path = '/' . ltrim((string) $native['path'], '/');
    $registry = ToolsSite::resolve($path);
    if ($registry === null) { continue; }
    $registryResolved++;
    if ((string) $registry['path'] !== $path) {
        $relabelled[] = $path . ' -> ' . $registry['path'];
    }
}
check($registryResolved >= 30, 'the served paths are actually matched against the registry (' . $registryResolved . ' resolved)');
check($relabelled === array(), 'no served tool path is re-labelled by the registry (' . implode(', ', $relabelled) . ')');

// --- One tool taxonomy: the categories the navigation publishes are the categories the PHP
// engine serves. A published category that only the theme fallback can resolve means a visitor
// who clicks "DNS & Domains" and a visitor who opens /tools are looking at different catalogues,
// and a published category with no tools behind it is a dead-end page for people and crawlers.
check(array_keys(Catalog::discovery()) === array('dns-domains','ip-network','security','ssl','email','website','developer','calculators','utilities'), 'discovery taxonomy is the published nine categories');
foreach (Site::catalog()['toolCategories'] as $category) {
    $slug = (string) $category['slug'];
    $resolved = Catalog::resolve('/tools/category/' . $slug);
    check($resolved !== null && $resolved['kind'] === 'category', 'published category resolves in the PHP tool catalogue: ' . $slug);
    check(isset(Catalog::discovery()[$slug]) && Catalog::discovery()[$slug] === $category['label'], 'published category label matches the discovery taxonomy: ' . $slug);
    $published = Catalog::toolsInDiscovery($slug);
    check(is_array($published) && count($published) > 0, 'published category lists at least one tool: ' . $slug);
}
// Tool cards and the hub hero point at real files: a missing icon is a broken image on 105 pages.
$assetRoot = dirname(__DIR__, 2) . '/assets/images/cloudhost247/tools/';
check(is_file($assetRoot . 'hero.svg'), 'tools hub hero illustration exists');
foreach (Catalog::enabledTools() as $tool) {
    check(is_file($assetRoot . $tool['category'] . '.svg'), 'tool card icon exists for category ' . $tool['category']);
}
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
check($mrzFooter['label'] === 'MRZ Generator', 'MRZ footer link uses the agreed public label');
// The renamed section: the MRZ page became "Compliance & Document Tools", a real hub page, and MRZ
// stayed reachable directly beside it. Both surfaces have to publish both, with the hub first.
$collectionUrl = 'tools/compliance-documents';
$collectionFooter = null;
foreach ($footerLinks as $link) {
    if (($link['url'] ?? '') === $collectionUrl) { $collectionFooter = $link; }
}
check($collectionFooter !== null, 'Compliance & Document Tools hub is published in the footer Tools column');
check($collectionFooter['label'] === 'Compliance & Document Tools', 'Compliance & Document hub uses the agreed public label');
$collectionMenu = false;
foreach ($menuLinks as $link) {
    if (($link['url'] ?? '') === $collectionUrl) { $collectionMenu = true; }
}
check($collectionMenu, 'Compliance & Document Tools hub is reachable from the Tools mega menu');
check(Catalog::resolve('/' . $collectionUrl)['kind'] === 'collection', 'the tools shell serves the collection hub route');
$collection = Catalog::collection('compliance-documents');
check($collection !== null && $collection['name'] === 'Compliance & Document Tools', 'the catalogue defines the collection');
$collectionGroups = Catalog::collectionGroups($collection);
$collectionToolCount = 0;
foreach ($collectionGroups as $group) {
    check($group['label'] !== '' && $group['tools'], 'collection group has a label and tools: ' . $group['slug']);
    foreach ($group['tools'] as $tool) {
        $collectionToolCount++;
        check(Catalog::resolve($tool['path'])['slug'] === $tool['slug'], 'collection card resolves: ' . $tool['slug']);
    }
}
check($collectionToolCount === 17, 'the collection publishes 17 tools (5 calculators + 12 generators), found ' . $collectionToolCount);
$collectionHtml = View::document($collection + array('kind' => 'collection'), '', '');
check(substr_count($collectionHtml, 'ch-tool-card') >= 17, 'the hub page renders a card for every tool');
check(strpos($collectionHtml, '<h1>Compliance &amp; Document Tools</h1>') !== false, 'the hub has its own h1');
check(strpos($collectionHtml, 'application/ld+json') !== false, 'the hub publishes structured data');
check(strpos($collectionHtml, 'rel="canonical"') !== false, 'the hub publishes a canonical URL');
check(strpos($collectionHtml, 'og:url') !== false, 'the hub publishes Open Graph metadata');
check(substr_count($collectionHtml, 'ch-collection-group') >= 5, 'the hub is organised into groups');
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
// The sitemap must publish the URLs the front controller serves - every one of them and nothing
// else. Publishing a route only the registry knows hands crawlers a noindex signpost, which is how
// the tool duplication in this pass stayed invisible; missing a served route hides a real page.
$published = array_map(function ($location) { return (string) preg_replace('~^https?://[^/]+~', '', $location); }, $locations[1]);
$published = array_map(function ($path) { return $path === '' ? '/' : $path; }, $published);
$servedPaths = array();
foreach (Catalog::enabledTools() as $tool) {
    $servedPaths[] = rtrim((string) $tool['path'], '/');
    check(in_array(rtrim((string) $tool['path'], '/'), $published, true), 'sitemap publishes the served tool path: ' . $tool['path']);
}
check(count($servedPaths) >= 100, 'the served catalogue is actually compared with the sitemap (' . count($servedPaths) . ' paths)');
foreach ($published as $path) {
    $resolved = Catalog::resolve($path);
    check($resolved !== null && !empty($resolved['kind']), 'sitemap entry is a route this shell serves: ' . $path);
}
foreach (array('/tools/color-tools', '/tools/favorites', '/tools/ping', '/tools/history') as $signpost) {
    check(!in_array($signpost, $published, true), 'sitemap does not advertise a route this shell cannot serve: ' . $signpost);
}
check(in_array('/tools/category/dns-domains', $published, true), 'sitemap publishes the discovery categories');
check(count($published) === count(array_unique($published)), 'sitemap publishes each URL once');

$context=Site::context(array('WEB_ROOT'=>'/billing', 'systemurl'=>'https://example.test/billing', 'cloudhost247ToolsPage'=>ToolsSite::resolve('/tools/dns-lookup')));
check($context['public']===true,'native public shell');
check($context['canonical']==='https://example.test/billing/tools/dns-lookup','subdirectory canonical');
check($context['title']==='DNS Lookup','specific metadata');
$mrzContext=Site::context(array('WEB_ROOT'=>'/billing', 'systemurl'=>'https://example.test/billing', 'cloudhost247ToolsPage'=>ToolsSite::resolve('/tools/mrz-generator')));
check($mrzContext['canonical']==='https://example.test/billing/tools/mrz-generator','MRZ canonical URL');
check($mrzContext['title']==='MRZ Generator','MRZ page metadata');
check(in_array('Tools',array_column(Site::catalog()['navigation'],'title'),true),'permanent Tools menu');
check(in_array('Tools',array_column(Site::catalog()['footer'],'title'),true),'permanent Tools footer');
echo "$count Tools shell, menu and footer assertions passed (PHP CLI; no licensed WHMCS runtime).\n";
