<?php
/**
 * CloudHost247 Network Tools — REST endpoint (docs section 77).
 *
 *   GET  api/index.php?route=dns/lookup&domain=example.com
 *   POST api/index.php?route=dns/propagation        (fields in the JSON body)
 *   GET  api/index.php?route=network/port-checker&host=example.com&ports=80,443
 *
 * Routes are the canonical slugs and the documented aliases, so
 * ?route=ip/blacklist resolves to security/ip-blacklist. The response is always
 * the same envelope as the tools platform:
 *
 *   {success, code, message, retryable, warnings, data, meta, tool, generated_at}
 *
 * Authentication: the module's REST API Token, sent as X-API-Token or
 * Authorization: Bearer. With no token configured the endpoint refuses every
 * request. Rate limits, SSRF protection, validation and provider readiness all
 * still apply — the API is a different door into the same runner, not a bypass.
 */

define('CLIENTAREA', false);

$whmcsRoot = dirname(__DIR__, 4);
if (!is_file($whmcsRoot . '/init.php')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('success' => false, 'code' => 'SERVICE_UNAVAILABLE', 'message' => 'WHMCS root not found.', 'retryable' => false));
    exit;
}
require_once $whmcsRoot . '/init.php';
require_once __DIR__ . '/../bootstrap.php';

use CloudHost247\NetworkTools\Core\Controller\ToolController;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;
use CloudHost247\NetworkTools\Core\Registry\ToolRegistry;
use WHMCS\Database\Capsule;

function ch247_nt_api_respond($status, array $payload)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    header('Referrer-Policy: no-referrer');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function ch247_nt_api_fail($code, $message, $httpStatus = 400, $retryable = false)
{
    ch247_nt_api_respond($httpStatus, array(
        'success' => false,
        'code' => $code,
        'message' => $message,
        'retryable' => (bool) $retryable,
    ));
}

function ch247_nt_api_token()
{
    $header = '';
    if (isset($_SERVER['HTTP_X_API_TOKEN'])) {
        $header = (string) $_SERVER['HTTP_X_API_TOKEN'];
    } elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $header = (string) $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (function_exists('getallheaders')) {
        foreach ((array) getallheaders() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0 || strcasecmp($name, 'X-API-Token') === 0) {
                $header = (string) $value;
                break;
            }
        }
    }
    if (stripos($header, 'bearer ') === 0) {
        $header = trim(substr($header, 7));
    }
    if ($header === '' && isset($_POST['token'])) {
        $header = (string) $_POST['token'];
    }
    return trim($header);
}

function ch247_nt_api_configured_token()
{
    try {
        $row = Capsule::table('tbladdonmodules')->where('module', 'cloudhost247_network_tools')->where('setting', 'api_token')->first();
        return $row && isset($row->value) ? (string) $row->value : '';
    } catch (\Throwable $unavailable) {
        return '';
    }
}

function ch247_nt_api_body()
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return array();
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : array();
}

$configured = ch247_nt_api_configured_token();
$presented = ch247_nt_api_token();
if ($configured === '') {
    ch247_nt_api_fail('CONFIGURATION_REQUIRED', 'The tools REST API is disabled: no API token has been configured in the module settings.', 503);
}
if ($presented === '' || !hash_equals($configured, $presented)) {
    ch247_nt_api_fail('ACCESS_DENIED', 'Unauthorized. Send the configured token as X-API-Token or Authorization: Bearer.', 401);
}

$route = '';
if (isset($_GET['route']) && is_scalar($_GET['route'])) {
    $route = (string) $_GET['route'];
} elseif (isset($_SERVER['PATH_INFO'])) {
    $route = trim((string) $_SERVER['PATH_INFO'], '/');
} elseif (isset($_SERVER['REQUEST_URI'])) {
    $path = parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (is_string($path) && preg_match('#/api/tools/(.+)$#', $path, $matches)) {
        $route = $matches[1];
    }
}
$route = strtolower(trim(preg_replace('#[^a-z0-9/\-]#i', '', $route), '/'));
if ($route === '') {
    ch247_nt_api_fail('INVALID_INPUT', 'Specify a route, for example ?route=dns/propagation.', 400);
}
if ($route === 'list' || $route === 'tools') {
    $aliases = array();
    foreach (ToolRegistry::aliases() as $alias => $target) {
        $aliases[$target][] = $alias;
    }
    $tools = array();
    foreach (ToolRegistry::all() as $definition) {
        $tools[] = array(
            'slug' => $definition->slug(),
            'name' => $definition->name(),
            'category' => $definition->category(),
            'summary' => $definition->summary(),
            'aliases' => isset($aliases[$definition->slug()]) ? $aliases[$definition->slug()] : array(),
            'target_field' => $definition->targetField(),
            'visibility' => $definition->visibility(),
            'requires_auth' => $definition->requiresAuth(),
            'client_only' => $definition->isClientOnly(),
            'high_risk' => $definition->isHighRisk(),
            'rate_tier' => $definition->rateTier(),
            'timeout_seconds' => $definition->timeoutSeconds(),
            'cache_seconds' => $definition->cacheSeconds(),
            'exports' => $definition->exports(),
            'fields' => array_map(function ($field) {
                $descriptor = $field->toArray();
                unset($descriptor['sensitive']);
                return $descriptor;
            }, $definition->fields()),
        );
    }
    ch247_nt_api_respond(200, array('success' => true, 'code' => 'OK', 'message' => '', 'retryable' => false, 'data' => array('tools' => $tools, 'count' => count($tools))));
}

$controller = new ToolController();
$method = strtoupper(isset($_SERVER['REQUEST_METHOD']) ? (string) $_SERVER['REQUEST_METHOD'] : 'GET');
if (!in_array($method, array('GET', 'POST'), true)) {
    ch247_nt_api_fail('INVALID_INPUT', 'Use GET or POST.', 405);
}
$input = $method === 'POST' ? array_merge($_GET, ch247_nt_api_body()) : $_GET;
unset($input['route'], $input['token']);

// Platform-level switches and client-scoped resources.
$settings = new SettingsRepository();
if (!$settings->bool('enabled')) {
    ch247_nt_api_fail('SERVICE_UNAVAILABLE', 'The tools platform is currently disabled by an administrator.', 503, true);
}
$context = array(
    'actor' => 'api',
    'client_id' => 0,
    'admin_id' => 0,
    'ip' => isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '',
    'request' => 'api',
);
if ($route === 'tools/history' || $route === 'tools/favorites') {
    $clientId = isset($input['client_id']) ? (int) $input['client_id'] : 0;
    if ($clientId <= 0) {
        ch247_nt_api_fail('INVALID_INPUT', 'tools/history and tools/favorites require a client_id parameter. They expose one customer\'s own records and are intended for server-to-server use with the platform token.', 400);
    }
    $context['client_id'] = $clientId;
    if ($route === 'tools/history' && $method === 'POST' && isset($input['action']) && $input['action'] === 'clear') {
        $controller->clearHistory($clientId);
        ch247_nt_api_respond(200, array('success' => true, 'code' => 'OK', 'message' => 'History cleared.', 'retryable' => false, 'data' => array('cleared' => true)));
    }
    $items = $route === 'tools/history' ? $controller->history($clientId, 100) : $controller->favorites($clientId);
    ch247_nt_api_respond(200, array(
        'success' => true,
        'code' => 'OK',
        'message' => '',
        'retryable' => false,
        'data' => array($route === 'tools/history' ? 'history' : 'favorites' => $items, 'count' => count($items)),
    ));
}

$definition = ToolRegistry::get($route);
if ($definition === null) {
    ch247_nt_api_fail('NOT_FOUND', 'No tool is registered for route "' . $route . '".', 404);
}
$result = $controller->run($definition->slug(), $input, $context, 'api');
$presentedResult = $result['presented'];
ch247_nt_api_respond(200, array(
    'success' => $presentedResult['ok'],
    'code' => $presentedResult['code'],
    'message' => $presentedResult['message'],
    'retryable' => $presentedResult['retryable'],
    'warnings' => $presentedResult['warnings'],
    'data' => json_decode($presentedResult['json'], true),
    'meta' => $presentedResult['meta'],
    'tool' => $definition->slug(),
    'generated_at' => $presentedResult['generated_at'],
));
