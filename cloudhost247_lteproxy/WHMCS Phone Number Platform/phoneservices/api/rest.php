<?php
/**
 * REST API Entry Point
 * All API requests route through here
 */

use PhoneServices\Core\Router;
use PhoneServices\API\Middleware\AuthMiddleware;

require_once __DIR__ . '/../../vendor/autoload.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$router = new Router();
$router->addMiddleware(AuthMiddleware::class);
$router->dispatch();
