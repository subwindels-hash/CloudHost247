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
// `cloudhost247-page.php` is the editorial route; an unpublished or unknown slug is the one route
// that legitimately renders `PublicPage::missing()` and is marked noindex.
$pages = array('index.php' => 'homepage.tpl', 'notfound.php' => 'cloudhost247-page.tpl', 'cloudhost247-page.php' => 'cloudhost247-page.tpl');
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
require $root . '/modules/addons/cloudhost247_theme/lib/ToolsSite.php';
$pages['tools'] = 'cloudhost247-tools.tpl';
foreach (\CloudHost247\Theme\ToolsSite::catalog()['tools'] as $entry) { $pages[ltrim($entry['path'],'/')] = 'cloudhost247-tools.tpl'; }
// The PHP tools front controller resolves the native catalogue first and only then the theme
// projection, so its surface is wider than `tools.json`: without this the harness would never
// render the tools that only the native catalogue knows (DNS Checker, SSL Checker, JSON
// Beautifier — the ones the homepage links to).
$nativeTools = array();
if (is_file($root . '/tools/lib/bootstrap.php')) {
    require_once $root . '/tools/lib/bootstrap.php';
    foreach (\CloudHost247\Tools\Catalog::enabledTools() as $entry) {
        $nativeTools['/' . ltrim($entry['path'], '/')] = $entry;
    }
    foreach (\CloudHost247\Tools\Catalog::discovery() as $slug => $label) {
        $pages['tools/category/' . $slug] = 'cloudhost247-tools.tpl';
        $nativeTools['/tools/category/' . $slug] = null;
    }
    foreach ($nativeTools as $path => $entry) {
        if (\CloudHost247\Theme\ToolsSite::resolve($path) === null) { $pages[ltrim($path, '/')] = 'cloudhost247-tools.tpl'; }
    }
}
$pages['privacy-policy.php'] = 'privacypolicy.tpl';
$pages['cookie-policy.php'] = 'cookiepolicy.tpl';
$pages['acceptable-use-policy.php'] = 'acceptableusepolicy.tpl';
foreach ($pages as $path => $template) {
    unset($toolTitle);
    $_SERVER['SCRIPT_NAME'] = '/' . $path;

    // Resolve the tool first: the tools front controller assigns `cloudhost247ToolsPage` before the
    // ClientAreaPage hook runs, which is why `Site::context` can build the tool title, summary and
    // canonical. Building `ch247Site` without it would mark every tool page noindex in the fixtures
    // and produce SEO evidence for pages the site does not actually ship that way.
    $tool = null;
    if ($template === 'cloudhost247-tools.tpl') {
        $tool = \CloudHost247\Theme\ToolsSite::resolve('/' . $path);
        if ($tool === null && isset($nativeTools['/' . $path])) { $tool = $nativeTools['/' . $path]; }
        if ($tool !== null && !isset($tool['kind'])) {
            // The theme projection carries no `kind`; the renderer needs one to pick the layout.
            $tool['kind'] = $path === 'tools' ? 'hub' : (strpos($path, 'tools/category/') === 0 ? 'category' : 'tool');
        }
        if ($tool !== null && $tool['kind'] === 'category' && !isset($tool['slug'])) {
            $tool['slug'] = substr($path, strlen('tools/category/'));
        }
    }

    // Only the editorial route assigns `cloudhost247Page` (`PublicPage::respond`), and only a
    // published slug can be indexable. A synthetic "missing" page on every WHMCS-managed route would
    // mark the homepage noindex and give seventy unrelated pages the same 'Client Area' title.
    $page = isset($catalog['pages'][$path]) ? \CloudHost247\Theme\Site::editorial($catalog['pages'][$path]['slug']) : null;
    if ($page === null && $path === 'cloudhost247-page.php') {
        require_once $root . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';
        $page = \CloudHost247\Theme\PublicPage::missing("We couldn't find that page.");
    }

    $vars = array('WEB_ROOT' => '', 'systemurl' => 'https://example.test', 'templatefile' => $path === 'index.php' ? 'homepage' : '');
    if ($page !== null) { $vars['cloudhost247Page'] = $page; }
    if ($tool !== null) {
        // `tools/index.php` serves the native catalogue and treats every route that only the shared
        // registry knows as a signpost: no implementation here, no canonical, no index. The harness
        // has to make the same distinction or it would check thirty thin tool pages the site does
        // not publish (and report their duplicate titles as a defect).
        $nativeServed = isset($nativeTools['/' . $path]) && $nativeTools['/' . $path] !== null;
        $unserved = isset($tool['kind']) && $tool['kind'] === 'tool' && !$nativeServed;
        $vars['cloudhost247ToolsPage'] = array(
            'path' => '/' . $path,
            'name' => isset($tool['name']) ? $tool['name'] : 'CloudHost247 Tools',
            'summary' => isset($tool['summary']) ? $tool['summary'] : '',
            'slug' => isset($tool['slug']) ? $tool['slug'] : '',
            'unserved' => $unserved,
        );
    }
    $site = \CloudHost247\Theme\Site::context($vars, array('platform_base_path'=>'/platform'));

    $smarty->clearAllAssign();
    $smarty->assign(array('WEB_ROOT'=>'','template'=>'cloudhost247','pagetitle'=>$site['title'],'ch247Site'=>$site,'cloudhost247'=>array('settings'=>array(),'sections'=>array()),'date_year'=>'2026','loggedin'=>false,'languagechangeenabled'=>false,'currencies'=>array(),'ch247Builder'=>false));
    if ($page !== null) { $smarty->assign('cloudhost247Page', $page); }
    if ($template === 'cloudhost247-tools.tpl') {
        $smarty->assign(array('cloudhost247ToolsPage'=>$vars['cloudhost247ToolsPage'],'chToolsReady'=>false,'chToolsPlatform'=>'/platform','chToolsBase'=>''));
        if (!empty($vars['cloudhost247ToolsPage']['unserved'])) { $smarty->assign('chToolsPlatformUrl', '/tools/' . rawurlencode($vars['cloudhost247ToolsPage']['slug'])); }
        // The real route server-renders the tool body (`View::fragment`) and sets the tool title; the
        // fixture has to do the same or a tool page would be checked as header + footer only, and a
        // heading, form or icon that only exists inside the body would never be looked at.
        if ($tool !== null && ($tool['kind'] !== 'tool' || isset($tool['handler']))) {
            $smarty->assign('chToolsHtml', \CloudHost247\Tools\View::fragment($tool, '', ''));
            $toolTitle = isset($tool['name']) ? $tool['name'] : $site['title'];
        }
    }
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
    $pageTitle = isset($toolTitle) ? $toolTitle : $site['title'];
    $smarty->assign('pagetitle', $pageTitle);
    // The head comes from the theme itself, not from a hand-written copy: stylesheet order
    // (site.css then design-system.css), favicons, canonical, Open Graph, JSON-LD and the
    // conditional `noindex` are all part of what a visitor and a crawler receive, so the fixtures
    // have to render the shipped partial or the QA would be checking a page nobody gets.
    $html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') . ' | CloudHost247</title>' . $smarty->fetch('cloudhost247/includes/site-head.tpl') . '</head><body class="ch-site ch-public">';
    $html .= $smarty->fetch('cloudhost247/includes/site-nav.tpl') . '<div id="ch-main" tabindex="-1"></div>' . $smarty->fetch('cloudhost247/' . $template) . $smarty->fetch('cloudhost247/includes/site-footer.tpl');
    $html .= '</body></html>';
    if (!is_dir(dirname($out . '/' . $path . '.html'))) { mkdir(dirname($out . '/' . $path . '.html'), 0777, true); }
    file_put_contents($out . '/' . $path . '.html', $html);
}
echo count($pages) . " first-party page fixtures rendered. No WHMCS or database behavior is simulated.\n";
