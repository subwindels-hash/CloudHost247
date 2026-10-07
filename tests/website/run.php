<?php
require dirname(__DIR__) . '/theme/fakes.php';
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/Site.php';
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/PublicDiscovery.php';
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/CrawlPolicy.php';
use CloudHost247\Theme\Site;
use CloudHost247\Theme\PublicPage;
use CloudHost247\Theme\PublicDiscovery;
use CloudHost247\Theme\CrawlPolicy;
ch247_theme_fresh();
$tests = array();
$tests['known editorial route resolves without invented product rows'] = PublicPage::resolve('web-hosting')['editorial_default'] === true && !isset(PublicPage::resolve('web-hosting')['product_component']);
ch247_theme_seed_content(1, 'page', 'web-hosting', 'Private draft', 0, false, array('body' => 'NEVER PUBLIC'));
$tests['explicit drafts override shipped editorial fallback'] = PublicPage::resolve('web-hosting') === null;
$tests['unknown routes remain missing'] = PublicPage::resolve('does-not-exist') === null;
$tests['legal terms are never invented'] = Site::editorial('terms-of-service') === null;
$tests['same origin mount accepted'] = Site::platformPath('/platform/') === '/platform';
foreach (array('//evil.test', 'https://evil.test', '/foo/../admin', '/foo?x=1', '/foo#bar', '/%2e%2e', '/foo\\bar', 'http://localhost:3000') as $bad) {
    $tests['unsafe mount rejected: ' . $bad] = Site::platformPath($bad) === '';
}
$_SERVER['SCRIPT_NAME'] = '/web-hosting.php';
$context = Site::context(array('WEB_ROOT' => '/billing', 'systemurl' => 'https://example.test/billing', 'cloudhost247Page' => array('seo_description' => '</script><script>alert(1)</script>')));
$tests['subdirectory canonical uses configured SystemURL'] = $context['canonical'] === 'https://example.test/billing/web-hosting.php';
$tests['structured data cannot close script element'] = strpos($context['schema_json'], '</script>') === false;
$tests['infrastructure locations are not generated'] = !isset($context['locations']);
CH247ThemeFakeDB::$failTables = array('mod_cloudhost247_theme_content');
$tests['database outage never republishes fallback over hidden pages'] = PublicPage::resolve('wordpress-hosting') === null;
CH247ThemeFakeDB::$failTables = array();
$repository = new \CloudHost247\Theme\ThemeRepository();
$repository->publishContent(1);
$tests['reviewed draft publishes without changing its body'] = PublicPage::resolve('web-hosting')['body'] === 'NEVER PUBLIC';
try { $repository->publishContent(9999); $missingRejected = false; } catch (\InvalidArgumentException $e) { $missingRejected = true; }
$tests['publishing a missing record is refused'] = $missingRejected;
// The PHP theme registry and the SPA both render `shared/site/registry.json`, so the published
// product families are asserted by id — the same contract the navigation API test pins — rather
// than by a count that silently drifts every time a family is added.
$families = array_map(function ($menu) { return isset($menu['id']) ? $menu['id'] : null; }, Site::catalog()['navigation']);
$tests['registry publishes every mega menu family'] = $families === array(
    'hosting', 'cloud', 'domains', 'platforms', 'developers', 'websites', 'tools', 'resources', 'support',
);
$tests['every mega menu family has a title and description'] = count(array_filter(Site::catalog()['navigation'], function ($menu) {
    return trim((string) $menu['title']) === '' || trim((string) $menu['description']) === '';
})) === 0;
$tests['only the tools menu may be groups-free'] = count(array_filter(Site::catalog()['navigation'], function ($menu) {
    return count($menu['groups']) === 0 && $menu['id'] !== 'tools';
})) === 0;
$tests['footer columns are all populated'] = count(array_filter(Site::catalog()['footer'], function ($column) {
    return count($column['links']) === 0;
})) === 0;
// Exercise actual repository reads, including localization and a failed database.
ch247_theme_fresh();
$pages = PublicDiscovery::pages($repository);
$paths = PublicDiscovery::sitemapPaths($pages);
$tests['discovery retains registered non-CMS policies'] = in_array('privacy-policy.php', $paths, true);
$tests['homepage has one sitemap entry'] = count(array_keys($paths, '', true)) === 1;
foreach (array('terms-of-service.php', 'legal-notice.php', 'data-protection-standards.php') as $path) {
    $tests['unpublished CMS legal route absent: ' . $path] = !in_array($path, $paths, true);
}
$tests['empty search does not list every page'] = PublicDiscovery::search($pages, '  ') === array();
$tests['array query is refused'] = PublicDiscovery::search($pages, array('q')) === array();
ch247_theme_seed_content(1, 'landing', 'web-hosting', 'DRAFT LANDING SECRET', 0, false, array('body' => 'hiddenneedle'));
ch247_theme_seed_content(2, 'page', 'private-campaign', 'DRAFT PAGE SECRET', 0, false, array('body' => 'hiddenneedle'));
ch247_theme_seed_content(3, 'landing', 'launch-event', 'Published Launch', 0, true, array('summary' => 'New application launch', 'body' => '<p>Visiblebodyneedle &amp; partners</p>'));
ch247_theme_seed_content(4, 'page', 'custom-guide', 'Published Guide', 0, true);
ch247_theme_seed_content(5, 'page', 'terms-of-service', 'Reviewed Terms', 0, true, array('body' => '<p>Reviewed policy content</p>'));
ch247_theme_seed_content(6, 'page', 'omit-from-sitemap', 'Published Unlisted', 0, true, array('sitemap' => false));
ch247_theme_seed_content(7, 'section', 'private-section', 'Sectionneedle', 0, true);
$index = $repository->publicPageIndex();
$pages = PublicDiscovery::pages($repository);
$paths = PublicDiscovery::sitemapPaths($pages);
$tests['draft payload is not exposed by repository index'] = $index['web-hosting'] === null && $index['private-campaign'] === null;
$tests['landing draft suppresses known editorial route'] = !in_array('web-hosting.php', $paths, true);
$tests['draft page has no discovery URL'] = !in_array('cloudhost247-page.php?slug=private-campaign', $paths, true);
$tests['draft titles and bodies are not searched'] = PublicDiscovery::search($pages, 'hiddenneedle') === array() && PublicDiscovery::search($pages, 'DRAFT') === array();
$tests['published custom landing is discovered'] = in_array('cloudhost247-page.php?slug=launch-event', $paths, true);
$tests['published custom page is discovered'] = in_array('cloudhost247-page.php?slug=custom-guide', $paths, true);
$tests['missing optional summary is safe'] = PublicDiscovery::search($pages, 'Published Guide')[0]['summary'] === '';
$tests['published CMS legal route is discovered'] = in_array('terms-of-service.php', $paths, true);
$tests['registered CMS URL never duplicates canonical route'] = !in_array('cloudhost247-page.php?slug=terms-of-service', $paths, true);
$tests['sitemap opt-out is preserved'] = !in_array('cloudhost247-page.php?slug=omit-from-sitemap', $paths, true);
$tests['sitemap opt-out is not confused with unpublication'] = count(PublicDiscovery::search($pages, 'Published Unlisted')) === 1;
$tests['published sections are not standalone pages'] = PublicDiscovery::search($pages, 'Sectionneedle') === array();
$results = PublicDiscovery::search($pages, 'visiblebodyneedle & partners');
$tests['published body search is case-insensitive and decodes entities'] = count($results) === 1;
$tests['search results contain only presentation fields'] = array_keys($results[0]) === array('url', 'title', 'summary', 'category');
$tests['custom landing has useful search category'] = $results[0]['category'] === 'Landing page';
// An unpublished collision must not hide the entry that the public renderer serves.
ch247_theme_seed_content(8, 'page', 'web-hosting', 'Published Hosting Override', 9, true);
ch247_theme_seed_content(9, 'landing', 'custom-guide', 'Later Published Alias', -10, true);
$pages = PublicDiscovery::pages($repository);
$tests['published page wins over draft landing sharing a slug'] = count(PublicDiscovery::search($pages, 'Published Hosting Override')) === 1;
$tests['duplicate published slugs use renderer selection order'] = $repository->publicPageIndex()['custom-guide']['id'] === $repository->findPublishedPage('custom-guide')['id'];
$tests['duplicate published slug gets one discovery URL'] = count(PublicDiscovery::search($pages, 'Later Published Alias')) === 0;
$repository->saveTranslation(array('content_id' => 3, 'locale' => 'french', 'title' => 'Lancement traduit', 'summary' => 'Sommaire public', 'body' => '<p>Contenu traduit</p>'));
$repository->saveTranslation(array('content_id' => 2, 'locale' => 'french', 'title' => 'Secret traduit', 'body' => 'hiddenneedle'));
$translated = PublicDiscovery::pages($repository, 'french');
$tests['published translations are searchable'] = count(PublicDiscovery::search($translated, 'Lancement traduit')) === 1;
$tests['draft translations remain absent'] = PublicDiscovery::search($translated, 'Secret traduit') === array();
$tests['translated result keeps canonical custom URL'] = PublicDiscovery::search($translated, 'Contenu traduit')[0]['url'] === 'cloudhost247-page.php?slug=launch-event';
foreach (array('mod_cloudhost247_theme_content', 'mod_cloudhost247_theme_translations') as $table) {
    CH247ThemeFakeDB::$failTables = array($table);
    try { PublicDiscovery::pages($repository, 'french'); $failedClosed = false; } catch (\Throwable $e) { $failedClosed = true; }
    $tests['discovery fails closed for ' . $table] = $failedClosed;
}
CH247ThemeFakeDB::$failTables = array();
$tests['query matching is literal, not regex'] = PublicDiscovery::search($pages, '.*') === array();
$tests['long search query is bounded'] = PublicDiscovery::search($pages, str_repeat('x', 100) . 'Published Guide') === array();
for ($i = 100; $i < 150; $i++) {
    ch247_theme_seed_content($i, 'page', 'bounded-' . $i, 'Boundedneedle ' . $i, 0, true);
}
$tests['search returns at most forty results'] = count(PublicDiscovery::search(PublicDiscovery::pages($repository), 'Boundedneedle')) === 40;
// ---------------------------------------------------------------------------
// Crawl policy: one registry policy, four surfaces (Node robots/sitemap, the generated
// static robots.txt, robots.php and the PHP sitemaps). These assertions are the PHP half of
// that contract; cloudhost247-node/tests/integration/seo-routes.test.ts is the app half, and
// scripts/site/generate.mjs fails the build if the registry and the projections drift.
// ---------------------------------------------------------------------------
$registry = json_decode((string) file_get_contents(dirname(__DIR__, 2) . '/shared/site/registry.json'), true);
$expectedExclusions = array();
foreach (array_merge($registry['sitemap']['exclude'], $registry['sitemap']['excludePhp']) as $entry) {
    $path = '/' . preg_replace('~^\.?/+~', '', (string) $entry);
    if ($path !== '/') { $expectedExclusions[$path] = true; }
}
$expectedExclusions = array_keys($expectedExclusions);
sort($expectedExclusions);
$tests['crawl policy reads the registry exclusions'] = CrawlPolicy::exclusions() === $expectedExclusions;
$phpFallback = CrawlPolicy::FALLBACK_PHP_EXCLUSIONS;
sort($phpFallback);
$registryPhp = $registry['sitemap']['excludePhp'];
sort($registryPhp);
$tests['compiled PHP exclusion fallback matches the registry'] = $phpFallback === $registryPhp;
$spaFallback = CrawlPolicy::FALLBACK_SPA_EXCLUSIONS;
sort($spaFallback);
$registrySpa = $registry['sitemap']['exclude'];
sort($registrySpa);
$tests['compiled SPA exclusion fallback matches the registry'] = $spaFallback === $registrySpa;
$tests['homepage is never excluded'] = CrawlPolicy::isPublic('') && CrawlPolicy::isPublic('/');
$tests['marketing routes stay indexable'] = CrawlPolicy::isPublic('web-hosting.php') && CrawlPolicy::isPublic('/hosting/web-hosting');
foreach (array('dashboard', 'login', 'cart') as $spaPath) {
    $tests['gated app route excluded: /' . $spaPath] = !CrawlPolicy::isPublic('/' . $spaPath);
}
foreach (array('cart.php', 'clientarea.php', 'register.php', 'pwreset.php', 'logout.php', 'submitticket.php',
    'supporttickets.php', 'viewticket.php', 'site-search.php', 'service-error.php', 'tables.php',
    'tools/api.php', 'cloudhost247-sample.php') as $phpPath) {
    $tests['private PHP route excluded: ' . $phpPath] = !CrawlPolicy::isPublic($phpPath);
}
foreach (array('admin/', 'modules/', 'crons/', 'errors/', 'tools/data/', 'tools/admin/') as $directory) {
    $tests['private directory excluded: ' . $directory] = !CrawlPolicy::isPublic($directory) && !CrawlPolicy::isPublic($directory . 'index.php');
}
// A disallowed sitemap cannot be fetched, which silently voids the Sitemap: directive.
foreach (CrawlPolicy::SITEMAP_ENDPOINTS as $endpoint) {
    $tests['sitemap endpoint stays fetchable: ' . $endpoint] = CrawlPolicy::isPublic($endpoint);
}
// Every page the PHP theme publishes must be indexable, or the sitemap and robots.txt contradict.
$registeredPages = array_keys(Site::catalog()['pages']);
$privateRegistered = array_values(array_filter($registeredPages, function ($page) { return !CrawlPolicy::isPublic($page); }));
$tests['every registered public page is indexable'] = $privateRegistered === array();
$categorySlugs = array();
foreach (Site::catalog()['toolCategories'] as $category) {
    if (isset($category['slug'])) { $categorySlugs[] = $category['slug']; }
}
$tests['the registry publishes nine tool categories'] = count($categorySlugs) === 9;
$privateCategories = array_values(array_filter($categorySlugs, function ($slug) { return !CrawlPolicy::isPublic('/tools/category/' . $slug); }));
$tests['every published tool category is indexable'] = $privateCategories === array();
$tests['sitemap filter drops excluded paths only'] = CrawlPolicy::filter(array('web-hosting.php', 'cart.php', 'clientarea.php', 'tools/category/dns-domains'))
    === array('web-hosting.php', 'tools/category/dns-domains');
$tests['sitemap page URL is indexable'] = CrawlPolicy::isPublic('cloudhost247-page.php?slug=launch-event');
$root = dirname(__DIR__, 2);
foreach (array('cloudhost247-sitemap.php', 'tools-sitemap.php', 'builder-sitemap.php') as $sitemap) {
    $source = (string) file_get_contents($root . '/' . $sitemap);
    $tests['sitemap is marked noindex rather than blocked: ' . $sitemap] = strpos($source, "'X-Robots-Tag: noindex'") !== false;
}
$tests['theme sitemap applies the crawl policy'] = strpos((string) file_get_contents($root . '/cloudhost247-sitemap.php'), 'CrawlPolicy::filter') !== false;
$tests['robots.php applies the crawl policy'] = strpos((string) file_get_contents($root . '/robots.php'), 'CrawlPolicy::exclusions') !== false;
// ---------------------------------------------------------------------------
// Registry-driven page sections. `site.json` carries the application's narrative
// for every product page; scripts/site/generate.mjs projects and validates it, and
// these assertions pin what a stale or hand-edited registry would silently break.
// ---------------------------------------------------------------------------
$sectionTypes = array('features', 'cards', 'steps', 'checks', 'split', 'note');
$template = (string) file_get_contents(dirname(__DIR__, 2) . '/templates/cloudhost247/includes/product-sections.tpl');
foreach ($sectionTypes as $type) {
    $tests['section template renders ' . $type] = strpos($template, "'" . $type . "'") !== false || in_array($type, array('features', 'cards'), true);
}
$tests['product page uses the section renderer'] = strpos((string) file_get_contents(dirname(__DIR__, 2) . '/templates/cloudhost247/cloudhost247-page.tpl'), 'product-sections.tpl') !== false;
$tests['platform page uses the section renderer'] = strpos((string) file_get_contents(dirname(__DIR__, 2) . '/templates/cloudhost247/cloudhost247-platform.tpl'), 'product-sections.tpl') !== false;

// The section renderer may only use classes the site actually ships. `site-head.tpl` loads
// site.css and then design-system.css, and the design system wins every name the two share, so a
// class invented here that lives in neither file styles nothing at all — and one redefined here is
// silently overridden. Both mistakes were made once; this is the assertion that catches them.
$sectionClasses = array();
if (preg_match_all('/class="([^"]*)"/', $template, $matches)) {
    foreach ($matches[1] as $attribute) {
        foreach (preg_split('/\s+/', (string) preg_replace('/\{[^}]*\}/', ' ', $attribute)) as $class) {
            if ($class !== '' && strpos($class, 'ch') === 0) { $sectionClasses[$class] = true; }
        }
    }
}
$shippedCss = '';
foreach (array('site.css', 'design-system.css', 'custom.css', 'tools.css') as $sheet) {
    $file = dirname(__DIR__, 2) . '/templates/cloudhost247/css/' . $sheet;
    if (is_file($file)) { $shippedCss .= (string) file_get_contents($file); }
}
$undefinedClasses = array();
foreach (array_keys($sectionClasses) as $class) {
    if (preg_match('/\.' . preg_quote($class, '/') . '(?![\w-])/', $shippedCss) !== 1) { $undefinedClasses[] = $class; }
}
$tests['section renderer defines ' . count($sectionClasses) . ' classes and all of them ship'] = $undefinedClasses === array();
if ($undefinedClasses) { fwrite(STDERR, 'undefined classes: ' . implode(', ', $undefinedClasses) . "\n"); }

// The design system is the layer that wins, so the shared component names must come from it.
$designSystem = (string) file_get_contents(dirname(__DIR__, 2) . '/shared/site/design-system.css');
foreach (array('ch-card', 'ch-card__icon', 'ch-card__foot', 'ch-step', 'ch-step__index', 'ch-check-list', 'ch-note', 'ch-grid--3', 'ch-split', 'ch-section', 'ch-wrap') as $class) {
    if (in_array($class, array_keys($sectionClasses), true)) {
        $tests['section renderer uses the design system for ' . $class] = preg_match('/\.' . preg_quote($class, '/') . '(?![\w-])/', $designSystem) === 1;
    }
}

$sectionsSeen = array();
$sectionPages = 0;
foreach (Site::catalog()['pages'] as $path => $page) {
    if (!isset($page['sections'])) { continue; }
    if ($page['sections']) { $sectionPages++; }
    foreach ($page['sections'] as $section) {
        $sectionsSeen[$section['type']] = true;
        $tests['section has a heading: ' . $path] = trim((string) $section['heading']) !== '';
        $tests['section type is renderable: ' . $path] = in_array($section['type'], $sectionTypes, true);
        if (!empty($section['visual'])) {
            $tests['section illustration exists: ' . $section['visual']] = is_file(dirname(__DIR__, 2) . '/assets/images/cloudhost247/' . $section['visual'] . '.svg');
        }
        if ($section['type'] === 'split') {
            $tests['split section has an illustration: ' . $path] = !empty($section['visual']);
            $tests['split section has body copy: ' . $path] = !empty($section['body']);
        }
        foreach (isset($section['items']) ? $section['items'] : array() as $item) {
            $tests['section card has a title: ' . $path] = trim((string) $item['title']) !== '';
            if (!empty($item['url'])) {
                // A card links to a shipped page, a licensed WHMCS entry point or the tools surface;
                // anything else would be a dead link. `check-links.mjs` enforces the same rule for
                // the published navigation.
                $whmcsEntries = array('index.php', 'cart.php', 'clientarea.php', 'register.php', 'logout.php',
                    'pwreset.php', 'contact.php', 'knowledgebase.php', 'submitticket.php', 'serverstatus.php',
                    'announcements.php', 'supporttickets.php', 'viewticket.php', 'domainchecker.php');
                $destination = (string) $item['url'];
                $tests['section card destination is a shipped page: ' . $destination] = is_file(dirname(__DIR__, 2) . '/' . $destination)
                    || in_array($destination, $whmcsEntries, true)
                    || $destination === 'tools' || strpos($destination, 'tools/') === 0;
            }
            if (!empty($item['icon'])) {
                $tests['section card icon exists: ' . $item['icon']] = is_file(dirname(__DIR__, 2) . '/assets/images/cloudhost247/' . $item['icon']);
            }
        }
    }
}
$tests['sections reach a substantial share of product pages'] = $sectionPages >= 30;
$tests['sections cover every renderable type'] = count($sectionsSeen) >= 5;

// ---------------------------------------------------------------------------
// Fragment promises. The navigation publishes destinations such as
// `deployments.php#environments`; the page has to render that anchor, otherwise
// the link lands at the top of the page. scripts/site/generate.mjs fails the
// build on a dangling fragment; this is the same contract from the PHP side, and
// it also covers anchors that only the templates declare.
// ---------------------------------------------------------------------------
$anchors = array();
function collect_anchors($name, $root, &$anchors, &$seen)
{
    if (isset($seen[$name])) { return; }
    $seen[$name] = true;
    $file = $root . '/templates/cloudhost247/' . $name . '.tpl';
    if (!is_file($file)) { return; }
    $source = (string) file_get_contents($file);
    if (preg_match_all('/id="([A-Za-z][\w-]*)"/', $source, $matches)) {
        foreach ($matches[1] as $anchor) { $anchors[$anchor] = true; }
    }
    if (preg_match_all('/\{include file="cloudhost247\/([^"]+)\.tpl"\}/', $source, $matches)) {
        foreach ($matches[1] as $include) { collect_anchors($include, $root, $anchors, $seen); }
    }
}
$anchorRoot = dirname(__DIR__, 2);
$knownAnchors = array();
$seenTemplates = array();
foreach (glob($anchorRoot . '/templates/cloudhost247/*.tpl') as $templateFile) {
    collect_anchors(basename($templateFile, '.tpl'), $anchorRoot, $knownAnchors, $seenTemplates);
}
foreach (Site::catalog()['pages'] as $page) {
    foreach (isset($page['sections']) ? $page['sections'] : array() as $section) {
        if (!empty($section['anchor'])) { $knownAnchors[$section['anchor']] = true; }
    }
}
$dangling = array();
foreach ($registry['menus'] as $menu) {
    $hrefs = array($menu['href']);
    foreach ($menu['columns'] as $column) {
        foreach ($column['items'] as $item) { $hrefs[] = $item['href']; }
    }
    foreach ($hrefs as $href) {
        $php = isset($href['php']) ? (string) $href['php'] : '';
        if (strpos($php, '#') === false) { continue; }
        list($file, $fragment) = explode('#', $php, 2);
        if (!isset($knownAnchors[$fragment])) { $dangling[] = $php; }
    }
}
$tests['navigation publishes no fragment the page does not render'] = $dangling === array();
// The surviving fragments are section-backed: they exist because the registry content for the
// paired app route is folded into that PHP page under the fragment as its anchor. If the fold
// stopped working, the anchors would disappear and the navigation would be promising dead
// fragments again — so the two lists must agree exactly.
$sectionAnchors = array();
foreach (Site::catalog()['pages'] as $page) {
    foreach (isset($page['sections']) ? $page['sections'] : array() as $section) {
        if (!empty($section['anchor'])) { $sectionAnchors[$section['anchor']] = true; }
    }
}
$fragmentDestinations = array();
foreach ($registry['menus'] as $menu) {
    $hrefs = array($menu['href']);
    foreach ($menu['columns'] as $column) {
        foreach ($column['items'] as $item) { $hrefs[] = $item['href']; }
    }
    foreach ($hrefs as $href) {
        $php = isset($href['php']) ? (string) $href['php'] : '';
        if (strpos($php, '#') !== false) { $fragmentDestinations[explode('#', $php, 2)[1]] = true; }
    }
}
$tests['every published fragment is backed by a registry section'] = count(array_diff_key($fragmentDestinations, $sectionAnchors)) === 0;

$failed=0;
foreach ($tests as $name=>$ok) { echo ($ok ? 'ok' : 'not ok') . ' - ' . $name . "\n"; if (!$ok) { $failed++; } }
echo '# ' . count($tests) . ' assertions, ' . $failed . " failed\n";
exit($failed ? 1 : 0);
