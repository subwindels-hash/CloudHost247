<?php
/**
 * REST API entry point.
 *
 * All internal service calls (client-area SPA, mobile clients, partner
 * integrations) route through here:
 *
 *   /modules/addons/phoneservices/api/rest.php/api/numbers
 *
 * Authentication: WHMCS session, `Authorization: ApiKey <id>.<secret>` or a
 * platform-issued bearer token. See lib/API/Middleware/AuthMiddleware.php.
 *
 * @package PhoneServices
 */

require_once __DIR__ . '/bootstrap.php';

use PhoneServices\API\Middleware\AuthMiddleware;
use PhoneServices\Core\Config;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Router;

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

// CORS: same-origin by default; additional origins are opt-in and explicit.
$allowedOrigins = array_filter(array_map('trim', explode(',', (string) Config::get('api_allowed_origins', ''))));
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');

if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $router = new Router();
    $router->addMiddleware(AuthMiddleware::class);
    $router->dispatch();
} catch (\Throwable $e) {
    Logger::exception($e, 'REST API');
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error'   => Config::isSandbox() ? $e->getMessage() : 'Internal server error',
    ]);
}
