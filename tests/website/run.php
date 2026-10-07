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
$failed=0;
foreach ($tests as $name=>$ok) { echo ($ok ? 'ok' : 'not ok') . ' - ' . $name . "\n"; if (!$ok) { $failed++; } }
echo '# ' . count($tests) . ' assertions, ' . $failed . " failed\n";
exit($failed ? 1 : 0);
