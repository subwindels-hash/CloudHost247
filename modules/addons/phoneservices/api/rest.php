<?php
/** Authenticated, same-origin REST entry point. */
require_once dirname(__DIR__) . '/bootstrap.php';

use PhoneServices\Core\Router;
use PhoneServices\API\Middleware\AuthMiddleware;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token');

// CORS is deliberately same-origin. Allow an explicitly configured origin only.
$origin = isset($_SERVER['HTTP_ORIGIN']) ? rtrim($_SERVER['HTTP_ORIGIN'], '/') : '';
$allowed = rtrim((string) \PhoneServices\Core\Config::get('api_allowed_origin', ''), '/');
if ($origin && $allowed && hash_equals($allowed, $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code($origin && $allowed && hash_equals($allowed, $origin) ? 204 : 403);
    exit;
}

$router = new Router();
$router->addMiddleware(AuthMiddleware::class);
$router->dispatch();
