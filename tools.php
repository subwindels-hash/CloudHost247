<?php
/**
 * CloudHost247 Network Tools — client-area front controller.
 *
 * This is the single entry point for /tools: the catalogue, every tool page,
 * history, favourites, reports and exports. It renders inside the active
 * CloudHost247 theme through WHMCS\ClientArea, so branding, navigation, header,
 * footer, dark/light mode and responsiveness come from the theme and no theme
 * file is replaced.
 *
 * Security posture:
 *   - the module must be active (addon enabled) or every route 404s;
 *   - identity comes from the real WHMCS session; nothing is trusted from the
 *     query string;
 *   - every state-changing request is CSRF-checked with the WHMCS token;
 *   - every execution goes through ToolRunner: visibility, operator state,
 *     provider readiness, capability checks, validation and rate limits;
 *   - a sensitive field value is never echoed back into the page, a log, a
 *     report or an export.
 */

use CloudHost247\NetworkTools\Core\Controller\ToolController;
use CloudHost247\NetworkTools\Core\Registry\ToolRegistry;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;

define('CLIENTAREA', true);
require __DIR__ . '/init.php';

$moduleDirectory = __DIR__ . '/modules/addons/cloudhost247_network_tools';
if (!is_file($moduleDirectory . '/bootstrap.php')) {
    http_response_code(404);
    exit;
}
require_once $moduleDirectory . '/bootstrap.php';

function ch247_tools_module_active()
{
    try {
        return (bool) Capsule::table('tbladdonmodules')->where('module', 'cloudhost247_network_tools')->exists();
    } catch (\Throwable $unavailable) {
        return false;
    }
}

function ch247_tools_respond_json($status, array $payload)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function ch247_tools_stream(array $export)
{
    header('Content-Type: ' . $export['content_type']);
    header('Content-Disposition: attachment; filename="' . $export['filename'] . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    echo $export['body'];
    exit;
}

$clientArea = new ClientArea();
$clientArea->initPage();

if (!ch247_tools_module_active()) {
    http_response_code(404);
    $clientArea->setPageTitle('Tools');
    $clientArea->assign('ch247Tools', array('available' => false, 'reason' => 'The tools platform is not active on this installation.'));
    $clientArea->setTemplate('cloudhost247-tools');
    $clientArea->output();
    exit;
}

$settings = new SettingsRepository();
$controller = new ToolController();
$area = (isset($_SESSION['adminid']) && (int) $_SESSION['adminid'] > 0 && isset($_GET['area']) && $_GET['area'] === 'admin') ? 'admin' : 'client';
$context = $controller->context($area);
$audience = $context['actor'] === 'admin' ? 'admin' : ($context['client_id'] > 0 ? 'customer' : 'public');
$authenticated = (int) $context['client_id'] > 0;
$publicAccess = $settings->bool('public_access');
$platformEnabled = $settings->bool('enabled');

$format = isset($_GET['format']) ? preg_replace('/[^a-z]/', '', strtolower((string) $_GET['format'])) : '';
$isJson = $format === 'json';
$view = isset($_GET['view']) ? preg_replace('/[^a-z\-]/', '', strtolower((string) $_GET['view'])) : 'catalog';
$slug = isset($_REQUEST['tool']) ? trim((string) $_REQUEST['tool']) : '';
$domainContext = isset($_GET['domain']) ? trim((string) $_GET['domain']) : '';
$action = isset($_POST['action']) ? preg_replace('/[^a-z\-]/', '', strtolower((string) $_POST['action'])) : '';
$notice = '';
$error = '';

// ---------------------------------------------------------------------------
// State-changing requests: CSRF first, then identity, then the action.
// ---------------------------------------------------------------------------
if ($action !== '') {
    $csrfOk = !function_exists('check_token') || check_token('WHMCS.default') !== false;
    if (!$csrfOk) {
        if ($isJson) {
            ch247_tools_respond_json(403, array('success' => false, 'code' => 'CSRF_FAILED', 'message' => 'The security token expired. Reload the page and try again.', 'retryable' => true));
        }
        $error = 'The security token expired. Reload the page and try again.';
        $action = '';
    }
}

if ($action === 'favorite' || $action === 'unfavorite') {
    if (!$platformEnabled || !$authenticated || (int) $context['client_id'] <= 0) {
        $error = 'Sign in to save favourites.';
    } else {
        $controller->toggleFavorite((int) $context['client_id'], $slug);
        if ($slug === 'diagnostics/monitors') {
            $view = 'monitors';
        } else {
            $view = 'tool';
        }
        $notice = 'Favourites updated.';
    }
} elseif ($action === 'clear-history') {
    if (!$authenticated) {
        $error = 'Sign in to manage your history.';
    } else {
        $controller->clearHistory((int) $context['client_id']);
        $notice = 'Your tool history has been cleared.';
        $view = 'history';
    }
} elseif ($action === 'save-report') {
    if (!$authenticated) {
        $error = 'Sign in to save reports.';
    } elseif ($slug === '' || !ToolRegistry::exists($slug)) {
        $error = 'That tool does not exist.';
    } else {
        $raw = isset($_POST['fields']) && is_array($_POST['fields']) ? $_POST['fields'] : array();
        $run = $controller->run($slug, $raw, $context, $area);
        if (!$run['ok']) {
            $error = 'Only a successful result can be saved as a report.';
            $view = 'tool';
        } else {
            $definition = $run['definition'];
            $label = $definition->hasSensitiveInput() ? '' : $definition->targetLabel($run['input']);
            $payload = array(
                'code' => $run['result']->code(),
                'status' => $run['result']->isOk() ? 'success' : 'failure',
                'tool_name' => $definition->name(),
                'target' => $label,
                'generated_at' => gmdate('c'),
                'warnings' => $run['result']->warnings(),
                'data' => $run['result']->data(),
            );
            $id = $controller->saveReport((int) $context['client_id'], $slug, $label, $payload);
            $notice = $id > 0 ? 'Report saved. Find it under Reports.' : 'The report could not be saved.';
            $view = 'reports';
        }
    }
} elseif ($action === 'delete-report') {
    $reportId = isset($_POST['report_id']) ? (int) $_POST['report_id'] : 0;
    if (!$authenticated) {
        $error = 'Sign in to manage your reports.';
    } elseif ($reportId > 0) {
        $reports = new \CloudHost247\NetworkTools\Core\Repository\ReportRepository();
        $reports->delete((int) $context['client_id'], $reportId);
        $notice = 'Report deleted.';
    }
    $view = 'reports';
}

// ---------------------------------------------------------------------------
// Report download (owner-only: the repository filters by client id).
// ---------------------------------------------------------------------------
if ($view === 'reports' && isset($_GET['download'])) {
    $reportId = (int) $_GET['download'];
    if (!$authenticated || $reportId <= 0) {
        $error = 'Sign in to download your reports.';
    } else {
        $reportRepository = new \CloudHost247\NetworkTools\Core\Repository\ReportRepository();
        $report = $reportRepository->find((int) $context['client_id'], $reportId);
        if (!$report) {
            $error = 'That report does not exist on this account.';
        } else {
            $payload = json_decode((string) $report->payload_json, true);
            if (!is_array($payload)) {
                $payload = array('raw' => '');
            }
            $export = array(
                'ok' => true,
                'filename' => 'cloudhost247-report-' . $reportId . '-' . gmdate('Ymd-His') . '.json',
                'content_type' => 'application/json; charset=utf-8',
                'body' => json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'generator' => 'server',
            );
            ch247_tools_stream($export);
        }
    }
}

// ---------------------------------------------------------------------------
// Exports and the print view.
// ---------------------------------------------------------------------------
if ($slug !== '' && isset($_GET['export']) && $authenticated === false && !$publicAccess) {
    $error = 'Sign in to export results.';
} elseif ($slug !== '' && isset($_GET['export'])) {
    $formatRequested = preg_replace('/[^a-z0-9]/', '', strtolower((string) $_GET['export']));
    $raw = array();
    foreach ($_GET as $key => $value) {
        if (!in_array($key, array('tool', 'export', 'view', 'format'), true) && is_scalar($value)) {
            $raw[$key] = (string) $value;
        }
    }
    $run = $controller->run($slug, $raw, $context, $area);
    if ($formatRequested === 'pdf' || $formatRequested === 'png' || $formatRequested === 'svg') {
        // PDF/PNG/SVG are rendered by the browser from the same data: no PDF or
        // image library is bundled into a WHMCS addon, and pretending to have
        // generated a file server-side would be dishonest.
        $clientArea->setPageTitle('Export — ' . ($run['definition'] ? $run['definition']->name() : $slug));
        $clientArea->assign('ch247Tools', array(
            'available' => true,
            'view' => 'print',
            'print' => $run['presented'],
            'tool' => $run['definition'] ? $run['definition']->toArray() : array(),
            'format' => $formatRequested,
            'csrf' => function_exists('generate_token') ? generate_token('plain') : '',
        ));
        $clientArea->setTemplate('cloudhost247-tools');
        $clientArea->output();
        exit;
    }
    $export = $controller->export($run['presented'], $formatRequested, $slug);
    if ($export['ok'] && $export['generator'] === 'server') {
        ch247_tools_stream($export);
    }
    if ($isJson) {
        ch247_tools_respond_json(400, array('success' => false, 'code' => 'INVALID_INPUT', 'message' => 'That export format is not produced by the server.', 'retryable' => false));
    }
    $error = 'That export format is not available for this tool.';
}

// ---------------------------------------------------------------------------
// Running a tool (AJAX/JSON or a normal form post).
// ---------------------------------------------------------------------------
$runResult = null;
if ($slug !== '') {
    if (!ToolRegistry::exists($slug)) {
        if ($isJson) {
            ch247_tools_respond_json(404, array('success' => false, 'code' => 'NOT_FOUND', 'message' => 'That tool does not exist.', 'retryable' => false));
        }
        $error = 'That tool does not exist.';
        $slug = '';
    } elseif (isset($_POST['run_tool']) || isset($_GET['run'])) {
        $raw = isset($_POST['fields']) && is_array($_POST['fields']) ? $_POST['fields'] : $_GET;
        $csrfOk = !function_exists('check_token') || check_token('WHMCS.default') !== false;
        if (!$csrfOk) {
            if ($isJson) {
                ch247_tools_respond_json(403, array('success' => false, 'code' => 'CSRF_FAILED', 'message' => 'The security token expired. Reload the page and try again.', 'retryable' => true));
            }
            $error = 'The security token expired. Reload the page and try again.';
        } else {
            $runResult = $controller->run($slug, $raw, $context, $area);
            if ($isJson) {
                $presented = $runResult['presented'];
                ch247_tools_respond_json($runResult['ok'] ? 200 : 200, array(
                    'success' => $presented['ok'],
                    'code' => $presented['code'],
                    'message' => $presented['message'],
                    'retryable' => $presented['retryable'],
                    'warnings' => $presented['warnings'],
                    'data' => json_decode($presented['json'], true),
                    'meta' => $presented['meta'],
                    'tool' => $runResult['definition'] ? $runResult['definition']->slug() : $slug,
                    'generated_at' => $presented['generated_at'],
                ));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Data for the template.
// ---------------------------------------------------------------------------
$view = $view === 'catalog' && $slug !== '' ? 'tool' : $view;
if ($view === 'tool' && $slug === '' && $runResult === null) {
    $view = 'catalog';
}
$toolData = array();
$fieldData = array();
if ($slug !== '' && ToolRegistry::exists($slug)) {
    $definition = ToolRegistry::get($slug);
    $toolData = $definition->toArray();
    $toolData['status_detail'] = $controller->runner()->status($definition);
    $prefill = array();
    foreach ($definition->fields() as $field) {
        foreach ($_GET as $key => $value) {
            if ($key === $field->name() && is_scalar($value) && !$field->isSensitive()) {
                $prefill[$field->name()] = (string) $value;
            }
        }
    }
    $fieldData = $controller->fields($definition, $prefill);
}
$catalog = ($view === 'catalog') ? $controller->catalog(array(
    'audience' => $audience,
    'category' => isset($_GET['category']) ? (string) $_GET['category'] : '',
    'q' => isset($_GET['q']) ? (string) $_GET['q'] : '',
    'client_id' => (int) $context['client_id'],
)) : array('items' => array(), 'total' => 0, 'categories' => array(), 'filters' => array('q' => '', 'category' => ''));

$pageTitle = 'Tools';
if ($slug !== '' && ToolRegistry::exists($slug)) {
    $pageTitle = ToolRegistry::get($slug)->name();
} elseif ($view === 'history') {
    $pageTitle = 'Tool history';
} elseif ($view === 'favorites') {
    $pageTitle = 'Favourite tools';
} elseif ($view === 'reports') {
    $pageTitle = 'Tool reports';
} elseif ($view === 'monitors') {
    $pageTitle = 'Domain monitoring';
}
$clientArea->setPageTitle($pageTitle);

$monitors = null;
if ($view === 'monitors') {
    $monitors = $controller->run('diagnostics/monitors', array('action' => 'list'), $context, $area);
}

$clientArea->assign('ch247Tools', array(
    'available' => true,
    'platform_enabled' => $platformEnabled,
    'public_access' => $publicAccess,
    'authenticated' => $authenticated,
    'actor' => $context['actor'],
    'view' => $view,
    'slug' => $slug,
    'tool' => $toolData,
    'fields' => $fieldData,
    'catalog' => $catalog,
    'run' => $runResult === null ? null : $runResult['presented'],
    'run_ok' => $runResult === null ? null : $runResult['ok'],
    'run_input' => $runResult === null ? array() : $runResult['input'],
    'history' => $view === 'history' ? $controller->history((int) $context['client_id'], 100) : array(),
    'favorites' => $view === 'favorites' ? $controller->favorites((int) $context['client_id']) : array(),
    'reports' => $view === 'reports' ? $controller->reports((int) $context['client_id']) : array(),
    'monitors' => $monitors === null ? null : $monitors['presented'],
    'domain_context' => $domainContext !== '' ? array('domain' => $domainContext, 'shortcuts' => $controller->domainShortcuts($domainContext)) : null,
    'notice' => $notice,
    'error' => $error,
    'csrf' => function_exists('generate_token') ? generate_token('plain') : '',
    'base_url' => 'tools.php',
    'assets_url' => 'modules/addons/cloudhost247_network_tools/assets/',
    'export_formats' => array('json' => 'JSON', 'csv' => 'CSV', 'pdf' => 'PDF (print)', 'png' => 'PNG', 'svg' => 'SVG', 'txt' => 'TXT'),
    'history_url' => 'tools.php?view=history',
    'favorites_url' => 'tools.php?view=favorites',
    'reports_url' => 'tools.php?view=reports',
    'catalog_url' => 'tools.php',
));

$clientArea->setTemplate('cloudhost247-tools');
$clientArea->output();
