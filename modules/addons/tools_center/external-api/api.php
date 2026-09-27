<?php
/**
 * Tools Center API - Main Entry Point
 * All requests come through here and are routed to appropriate tool modules
 * 
 * @package ToolsCenterAPI
 * @version 1.0.0
 */

// Prevent direct access to this file if not via API
if (!defined('TOOLS_API')) {
    define('TOOLS_API', true);
}

// Error handling - return JSON errors, don't expose paths
error_reporting(E_ALL);
ini_set('display_errors', 0);

// Set JSON content type
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

// CORS headers - configure for your WHMCS domain
header('Access-Control-Allow-Origin: *'); // Restrict in production
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Load configuration
require_once __DIR__ . '/config.php';

// Load authentication
require_once __DIR__ . '/auth.php';

// Load cache system
require_once __DIR__ . '/cache.php';

// Load rate limiter
require_once __DIR__ . '/rate-limit.php';

// Response helper
function apiResponse($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function apiError($message, $status = 400, $code = null) {
    $response = ['success' => false, 'error' => $message];
    if ($code) $response['code'] = $code;
    apiResponse($response, $status);
}

// Get input data
$input = [];
$contentType = $_SERVER['CONTENT_TYPE'] ?? '';

if (strpos($contentType, 'application/json') !== false) {
    $json = file_get_contents('php://input');
    $input = json_decode($json, true) ?: [];
} else {
    $input = $_REQUEST;
}

// Get tool category and action
$category = $input['category'] ?? $_GET['category'] ?? '';
$action = $input['action'] ?? $_GET['action'] ?? '';

// Validate required parameters
if (empty($category)) {
    apiError('Tool category is required', 400, 'MISSING_CATEGORY');
}

if (empty($action)) {
    apiError('Tool action is required', 400, 'MISSING_ACTION');
}

// Validate authentication
$auth = new APIAuth($config);
if (!$auth->validateRequest()) {
    apiError('Unauthorized', 401, 'UNAUTHORIZED');
}

// Rate limiting
$rateLimiter = new RateLimiter($config);
$clientId = $auth->getClientId();
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

if (!$rateLimiter->check($clientId, $clientIp, $category, $action)) {
    apiError('Rate limit exceeded. Please try again later.', 429, 'RATE_LIMITED');
}

// Load tool module
$categoryFile = __DIR__ . '/tools/' . preg_replace('/[^a-z0-9_-]/i', '', $category) . '.php';

if (!file_exists($categoryFile)) {
    apiError('Tool category not found: ' . $category, 404, 'CATEGORY_NOT_FOUND');
}

require_once $categoryFile;

// Get tool function
$toolClass = ucfirst($category) . 'Tools';
if (!class_exists($toolClass)) {
    apiError('Tool class not found', 500, 'CLASS_NOT_FOUND');
}

$toolInstance = new $toolClass($config);

// Check if method exists
if (!method_exists($toolInstance, $action)) {
    apiError('Tool action not found: ' . $action, 404, 'ACTION_NOT_FOUND');
}

// Execute tool
$cache = new CacheManager($config);
$cacheKey = $category . '_' . $action . '_' . md5(serialize($input));
$cached = $cache->get($cacheKey);

if ($cached !== null) {
    apiResponse(['success' => true, 'data' => $cached, 'cached' => true]);
}

try {
    $result = $toolInstance->$action($input);
    
    // Cache successful results (5 minutes default)
    if ($result !== null && $result !== false) {
        $cache->set($cacheKey, $result, $config['cache_duration'] ?? 300);
    }
    
    apiResponse(['success' => true, 'data' => $result]);
} catch (Exception $e) {
    // Log error
    $logFile = __DIR__ . '/logs/error-' . date('Y-m-d') . '.log';
    $logDir = dirname($logFile);
    if (!is_dir($logDir)) {
        mkdir($logDir, 0755, true);
    }
    error_log(date('[Y-m-d H:i:s]') . ' ERROR: ' . $e->getMessage() . PHP_EOL, 3, $logFile);
    
    apiError('Tool execution failed: ' . $e->getMessage(), 500, 'EXECUTION_ERROR');
}