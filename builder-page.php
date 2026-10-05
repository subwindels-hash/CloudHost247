<?php
/**
 * Public front controller for Website Builder pages.
 *
 * This is the only route by which builder content reaches the internet, and it
 * is deliberately narrow:
 *
 *   - it serves the published copy of a page and nothing else;
 *   - a draft is reachable only with a valid, unexpired preview token, and is
 *     always marked noindex;
 *   - a scheduled page stays unavailable until its time arrives;
 *   - client-only pages check the real WHMCS session;
 *   - anything else is a 404.
 *
 * The page renders inside the active client area theme, so the existing
 * CloudHost247 branding, navigation, header and footer are preserved and no
 * theme file is replaced.
 */

use CloudHost247\Builder\Services\FormService;
use CloudHost247\Builder\Site\PageResolver;
use CloudHost247\Builder\Support\BuilderException;
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;

define('CLIENTAREA', true);
require __DIR__ . '/init.php';

$moduleDirectory = __DIR__ . '/modules/addons/cloudhost247_builder';
if (!is_file($moduleDirectory . '/bootstrap.php')) {
    http_response_code(404);
    exit;
}
require_once $moduleDirectory . '/bootstrap.php';

/**
 * The builder only serves pages while its addon module is active. Deactivating
 * the module takes builder URLs offline without deleting any content.
 */
function ch247_builder_module_active()
{
    try {
        return (bool) Capsule::table('tbladdonmodules')->where('module', 'cloudhost247_builder')->exists();
    } catch (\Throwable $unavailable) {
        return false;
    }
}

$clientArea = new ClientArea();
$clientArea->setPageTitle('CloudHost247');
$clientArea->initPage();

if (!ch247_builder_module_active()) {
    http_response_code(404);
    $clientArea->setPageTitle('Page not found');
    $clientArea->assign('ch247Builder', array(
        'found' => false,
        'reason' => 'This page is not available.',
        'preview' => false,
        'html' => '',
        'header_html' => '',
        'footer_html' => '',
        'form_result' => null,
        'login_url' => '',
    ));
    $clientArea->setTemplate('cloudhost247-builder-page');
    $clientArea->output();
    exit;
}

$slug = isset($_GET['slug']) ? (string) $_GET['slug'] : '';
$previewToken = isset($_GET['preview']) ? (string) $_GET['preview'] : '';

/*
 * Form submissions post back to the page that rendered the form. The result is
 * handed to the resolver so the confirmation appears in place; the submission
 * itself is stored and notified by FormService, which owns the token, honeypot
 * and rate-limit checks.
 */
$formResult = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && !empty($_POST['ch247_form_id'])) {
    $forms = new FormService();
    try {
        $outcome = $forms->submit($_POST, array('slug' => $slug));
        if (!empty($outcome['redirect'])) {
            header('Location: ' . $outcome['redirect']);
            exit;
        }
        $formResult = array('ok' => true, 'message' => $outcome['message']);
    } catch (BuilderException $expected) {
        $formResult = array('ok' => false, 'message' => $expected->getMessage());
    } catch (\Throwable $unexpected) {
        $formResult = array('ok' => false, 'message' => 'That message could not be sent. Please try again shortly.');
    }
}

$resolver = new PageResolver();
try {
    $result = $resolver->resolve($slug, array(
        'preview' => $previewToken,
        'form_result' => $formResult,
        'session' => array(
            'client_id' => isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : 0,
            'admin_id' => isset($_SESSION['adminid']) ? (int) $_SESSION['adminid'] : 0,
        ),
    ));
} catch (\Throwable $failure) {
    $result = array(
        'found' => false, 'status' => 500, 'preview' => false, 'page' => null,
        'html' => '', 'header_html' => '', 'footer_html' => '', 'css' => '',
        'meta' => array('title' => 'Page unavailable', 'description' => '', 'robots' => 'noindex,nofollow',
            'canonical' => '', 'og_image' => ''),
        'reason' => 'This page could not be displayed.',
    );
}

http_response_code((int) $result['status']);
$clientArea->setPageTitle($result['meta']['title']);

// Picked up by the module's ClientAreaHeadOutput hook, which writes the meta
// tags, the page stylesheet and the runtime assets into the theme head.
$GLOBALS['ch247_builder_render'] = $result;

$clientArea->assign('ch247Builder', array(
    'found' => !empty($result['found']),
    'preview' => !empty($result['preview']),
    'html' => $result['html'],
    'header_html' => $result['header_html'],
    'footer_html' => $result['footer_html'],
    'reason' => $result['reason'],
    'form_result' => isset($result['form_result']) ? $result['form_result'] : $formResult,
    'login_url' => isset($result['login_url']) ? $result['login_url'] : '',
    'title' => $result['page'] ? $result['page']['title'] : 'Page not found',
));
$clientArea->setTemplate('cloudhost247-builder-page');
$clientArea->output();
