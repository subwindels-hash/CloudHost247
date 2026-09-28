<?php
/**
 * CloudHost247 Tools - REST API endpoint.
 *
 * Token-authenticated JSON API over the same tool handlers, cache and rate
 * limiter that power the client area:
 *
 *   GET  api/index.php?action=list                 -> tool catalog
 *   POST api/index.php?action=run   (tool=<id> + params)  -> run a tool
 *
 * Authentication (all requests): send the admin-configured module setting
 * `api_token` either as an `X-API-Token` header, an `Authorization: Bearer`
 * header, or a POST field `token`. With no token configured the endpoint is
 * disabled and refuses every request.
 *
 * This file bootstraps WHMCS (init.php) so Capsule, module settings and the
 * WHMCS session infrastructure are available. It intentionally emits JSON
 * only — no HTML, no debug output.
 */

define('TOOLSRUN', true);

// Path to the WHMCS root: modules/addons/cloudhost247_tools/api/ -> 4 levels up.
$whmcsRoot = dirname(__DIR__, 4);
if (!is_file($whmcsRoot . '/init.php')) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(array('success' => false, 'message' => 'WHMCS root not found.'));
    exit;
}

require_once $whmcsRoot . '/init.php';
require_once __DIR__ . '/../includes/api.php';

/**
 * Emit a JSON response and stop.
 *
 * @param int   $status HTTP status code.
 * @param array $body   JSON payload.
 */
function cloudhost247_tools_api_respond($status, array $body)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body);
    exit;
}

// Everything is authenticated — no public routes, no session fallback.
$token = cloudhost247_tools_api_extract_token();
if (!cloudhost247_tools_api_authorized($token)) {
    cloudhost247_tools_api_respond(401, array(
        'success' => false,
        'message' => 'Unauthorized. Configure the module API token and send it as X-API-Token or Authorization: Bearer.',
    ));
}

$action = isset($_GET['action']) && is_string($_GET['action']) ? preg_replace('/[^a-z_]/', '', strtolower(trim($_GET['action']))) : '';

if (PHP_SAPI !== 'cli' && $_SERVER['REQUEST_METHOD'] !== 'POST' && $action !== 'list') {
    cloudhost247_tools_api_respond(405, array(
        'success' => false,
        'message' => 'Method not allowed. Use GET with action=list or POST with action=run.',
    ));
}

$result = cloudhost247_tools_api_dispatch($action, $_POST, cloudhost247_tools_api_rate_key($token));
cloudhost247_tools_api_respond($result['status'], $result['body']);
