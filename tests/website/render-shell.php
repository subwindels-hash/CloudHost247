<?php
/** Shell contract render only; these test doubles are NOT authentication or WHMCS emulation. */
namespace WHMCS\View { class Asset { public static function fontCssInclude($file) { return ''; } } }
namespace WHMCS\Utility\Environment { class WebHelper { public static function getBaseUrl() { return ''; } } }
namespace {
if (PHP_SAPI !== 'cli') { exit(1); }
$root = dirname(__DIR__, 2);
$path = getenv('CH247_SMARTY_PATH'); $parent = getenv('CH247_PARENT_PATH'); $out = getenv('CH247_FIXTURE_DIR');
if (!$path || !$parent || !$out) { exit(1); }
require $path . '/libs/Smarty.class.php';
require $root . '/modules/addons/cloudhost247_theme/lib/Site.php';
function routePath($name) { return '/index.php?rp=/' . rawurlencode($name); }
class EmptySidebar { public function hasChildren() { return false; } }
$templates = $out . '/shell-templates';
if (!is_dir($templates . '/cloudhost247/includes')) { mkdir($templates . '/cloudhost247/includes', 0777, true); }
foreach (glob($parent . '/includes/*.tpl') as $file) { copy($file, $templates . '/cloudhost247/includes/' . basename($file)); }
foreach (glob($root . '/templates/cloudhost247/includes/*.tpl') as $file) { copy($file, $templates . '/cloudhost247/includes/' . basename($file)); }
$smarty = new \Smarty();
$smarty->setTemplateDir(array($root . '/templates', $templates)); $smarty->setCompileDir($out . '/compiled');
$smarty->error_reporting = E_ALL & ~E_NOTICE & ~E_WARNING & ~E_DEPRECATED;
$smarty->registerPlugin('function','lang',function($args){ return isset($args['key']) ? htmlspecialchars($args['key'],ENT_QUOTES,'UTF-8') : ''; });
$smarty->registerPlugin('function','assetPath',function($args){ return '/assets/' . htmlspecialchars($args['file'],ENT_QUOTES,'UTF-8'); });
$smarty->registerPlugin('block','assetExists',function($args,$content){ return ''; });
foreach (array(false, true) as $loggedIn) {
    $_SERVER['SCRIPT_NAME'] = '/clientarea.php';
    $smarty->assign(array('charset'=>'UTF-8','WEB_ROOT'=>'','template'=>'cloudhost247','ch247Site'=>\CloudHost247\Theme\Site::context(array()),'loggedin'=>$loggedIn,'pagetitle'=>'Client Area','date_year'=>'2026','primaryNavbar'=>array(),'secondaryNavbar'=>array(),'primarySidebar'=>new EmptySidebar(),'secondarySidebar'=>new EmptySidebar(),'clientAlerts'=>array(),'locales'=>array(),'currencies'=>array(),'breadcrumb'=>array()));
    $html = $smarty->fetch('cloudhost247/header.tpl') . '<main><h1>Shell contract fixture</h1></main>' . $smarty->fetch('cloudhost247/footer.tpl');
    foreach (array('ch-header','ch-footer','main-body','modalAjax','modalChooseLanguage') as $marker) { if (strpos($html,$marker) === false) { throw new \RuntimeException('Missing ' . $marker); } }
    file_put_contents($out . '/shell-' . ($loggedIn ? 'authenticated' : 'guest') . '.html', $html);
}
echo "Guest and authenticated shell contracts rendered against upstream Twenty-One includes. No account operations exercised.\n";
}
