<?php
/** CLI-only visual harness. Renders shipped Smarty components, NOT a WHMCS emulator. */
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
$root = dirname(__DIR__, 2);
$smartyPath = getenv('CH247_SMARTY_PATH');
$out = getenv('CH247_FIXTURE_DIR');
if (!$smartyPath || !$out) { fwrite(STDERR, "Set CH247_SMARTY_PATH and CH247_FIXTURE_DIR.\n"); exit(1); }
require $smartyPath . '/libs/Smarty.class.php';
require $root . '/modules/addons/cloudhost247_theme/lib/Site.php';
function routePath($name) { return '/knowledgebase.php'; }
$smarty = new Smarty();
$smarty->registerPlugin('modifier', 'routePath', 'routePath');
$smarty->setTemplateDir($root . '/templates');
$smarty->setCompileDir($out . '/compiled');
$smarty->error_reporting = E_ALL & ~E_NOTICE & ~E_WARNING & ~E_DEPRECATED;
$smarty->registerPlugin('function', 'lang', function ($params) { return htmlspecialchars(isset($params['key']) ? $params['key'] : '', ENT_QUOTES, 'UTF-8'); });
$catalog = \CloudHost247\Theme\Site::catalog();
$pages = array('index.php' => 'homepage.tpl', 'notfound.php' => 'cloudhost247-page.tpl');
foreach ($catalog['pages'] as $path => $page) {
    $pages[$path] = 'cloudhost247-page.tpl';
}
$pages['cloudhost247-hosting.php'] = 'cloudhost247-product-catalog.tpl';
$pages['email-hosting.php'] = 'cloudhost247-email-hosting.tpl';
$pages['aboutus.php'] = 'aboutus.tpl';
$pages['faqs.php'] = 'faqs.tpl';
foreach (array('applications.php','operating-systems.php','deployments.php','server-management.php') as $path) { $pages[$path] = 'cloudhost247-platform.tpl'; }
$pages['infrastructure.php'] = 'cloudhost247-infrastructure.tpl';
foreach (array('site-search.php', 'site-search-unavailable.php', 'site-search-empty.php', 'site-search-long.php') as $path) {
    $pages[$path] = 'cloudhost247-search.tpl';
}
$pages['privacy-policy.php'] = 'privacypolicy.tpl';
$pages['cookie-policy.php'] = 'cookiepolicy.tpl';
$pages['acceptable-use-policy.php'] = 'acceptableusepolicy.tpl';
foreach ($pages as $path => $template) {
    $_SERVER['SCRIPT_NAME'] = '/' . $path;
    $site = \CloudHost247\Theme\Site::context(array('WEB_ROOT' => '', 'systemurl' => 'https://example.test', 'templatefile' => $path === 'index.php' ? 'homepage' : ''));
    $page = isset($catalog['pages'][$path]) ? \CloudHost247\Theme\Site::editorial($catalog['pages'][$path]['slug']) : null;
    if ($page === null) { $page = array('title' => isset($catalog['pages'][$path]) ? $catalog['pages'][$path]['title'] : "We couldn't find that page.", 'summary' => '', 'body' => '', 'missing' => true); }
    $smarty->clearAllAssign();
    $smarty->assign(array('WEB_ROOT'=>'','template'=>'cloudhost247','pagetitle'=>$site['title'],'ch247Site'=>$site,'cloudhost247Page'=>$page,'cloudhost247'=>array('settings'=>array(),'sections'=>array()),'date_year'=>'2026','loggedin'=>false,'languagechangeenabled'=>false,'currencies'=>array()));
    if ($path === 'email-hosting.php') {
        require_once $root . '/modules/servers/cloudhost247_email_hosting/lib/Repository/ContentRepository.php';
        $content = \CloudHost247\Email\Repository\ContentRepository::defaults();
        $smarty->assign(array('emailHero'=>$content['hero'],'emailProviderContent'=>$content['providers'],'emailDnsContent'=>$content['dns'],'emailFaqs'=>$content['faqs'],'emailProviders'=>array(),'emailComparison'=>array(),'emailPlanCount'=>0,'emailCurrency'=>'','emailCatalogError'=>''));
    }
    if ($template === 'cloudhost247-search.tpl') {
        $smarty->assign(array(
            'chSearchQuery' => $path === 'site-search-long.php' ? str_repeat('q', 100) : 'hosting', 'chSearchUnavailable' => $path === 'site-search-unavailable.php',
            'chSearchResults' => in_array($path, array('site-search.php', 'site-search-long.php'), true) ? array(array(
                'title' => $path === 'site-search-long.php' ? str_repeat('CloudHost247', 8) : 'Web hosting',
                'summary' => 'Hosting for your next project.',
                'url' => 'web-hosting.php', 'category' => 'Hosting',
            )) : array(), 'token' => 'fixture-only-not-a-session-token',
        ));
    }
    $smarty->assign(array('ch247Products'=>array(),'ch247CatalogError'=>''));
    $html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . htmlspecialchars($site['title'], ENT_QUOTES, 'UTF-8') . ' | CloudHost247</title><link rel="stylesheet" href="/templates/cloudhost247/css/custom.css"><link rel="stylesheet" href="/templates/cloudhost247/css/site.css"><script src="/templates/cloudhost247/js/site.js" defer></script></head><body class="ch-site ch-public">';
    $html .= $smarty->fetch('cloudhost247/includes/site-nav.tpl') . '<div id="ch-main" tabindex="-1"></div>' . $smarty->fetch('cloudhost247/' . $template) . $smarty->fetch('cloudhost247/includes/site-footer.tpl');
    $html .= '</body></html>';
    file_put_contents($out . '/' . $path . '.html', $html);
}
echo count($pages) . " first-party page fixtures rendered. No WHMCS or database behavior is simulated.\n";
