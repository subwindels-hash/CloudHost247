<?php
require dirname(__DIR__) . '/theme/fakes.php';
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/Site.php';
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';
use CloudHost247\Theme\Site;
use CloudHost247\Theme\PublicPage;
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
$tests['registry has all six mega menu categories'] = count(Site::catalog()['navigation']) === 6;
$failed=0;
foreach ($tests as $name=>$ok) { echo ($ok ? 'ok' : 'not ok') . ' - ' . $name . "\n"; if (!$ok) { $failed++; } }
echo '# ' . count($tests) . ' assertions, ' . $failed . " failed\n";
exit($failed ? 1 : 0);
