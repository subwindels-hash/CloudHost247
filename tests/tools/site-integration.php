<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/ToolsSite.php';
require dirname(__DIR__, 2) . '/modules/addons/cloudhost247_theme/lib/Site.php';
use CloudHost247\Theme\ToolsSite;
use CloudHost247\Theme\Site;
$count=0;
function check($ok, $name) { global $count; $count++; if (!$ok) { fwrite(STDERR, "FAIL: $name\n"); exit(1); } }
foreach (ToolsSite::catalog()['tools'] as $tool) {
    foreach (array_merge(array($tool['path']), $tool['legacyPaths']) as $path) {
        check(ToolsSite::resolve($path)['slug'] === $tool['slug'], 'canonical and alias ' . $path);
    }
}
foreach (ToolsSite::catalog()['categories'] as $slug=>$label) { check(ToolsSite::resolve('/tools/category/'.$slug)['name']===$label.' Tools', 'category'); }
foreach (array('/tools/no-such-tool', '/tools/../../config.php', '/tools/%2e%2e/config.php') as $path) { check(ToolsSite::resolve($path)===null,'unknown/unsafe route'); }
$context=Site::context(array('WEB_ROOT'=>'/billing', 'systemurl'=>'https://example.test/billing', 'cloudhost247ToolsPage'=>ToolsSite::resolve('/tools/dns-lookup')));
check($context['public']===true,'native public shell');
check($context['canonical']==='https://example.test/billing/tools/dns-lookup','subdirectory canonical');
check($context['title']==='DNS Lookup','specific metadata');
check(in_array('Tools',array_column(Site::catalog()['navigation'],'title'),true),'permanent Tools menu');
check(in_array('Tools',array_column(Site::catalog()['footer'],'title'),true),'permanent Tools footer');
echo "$count Tools shell assertions passed (PHP CLI; no licensed WHMCS runtime).\n";
