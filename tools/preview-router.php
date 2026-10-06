<?php
/**
 * Router for the PHP built-in server only. Production uses tools/.htaccess.
 * WHMCS product pages still require init.php and are not mocked here.
 */
$uri = parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH);
$uri = is_string($uri) ? $uri : '/';
$root = dirname(__DIR__);

if ($uri === '/tools/api.php') {
    $_SERVER['SCRIPT_NAME'] = '/tools/api.php';
    require __DIR__ . '/api.php';
    return true;
}

if ($uri === '/tools/admin' || $uri === '/tools/admin/' || $uri === '/tools/admin/index.php') {
    $_SERVER['SCRIPT_NAME'] = '/tools/admin/index.php';
    require __DIR__ . '/admin/index.php';
    return true;
}

if (strpos($uri, '/tools/data') === 0) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Forbidden';
    return true;
}

if ($uri === '/tools-sitemap.php') {
    require $root . '/tools-sitemap.php';
    return true;
}

if ($uri === '/' || $uri === '/index.php') {
    header('Location: /tools', true, 302);
    return true;
}

if ($uri === '/tools' || strpos($uri, '/tools/') === 0) {
    $_SERVER['SCRIPT_NAME'] = '/tools/index.php';
    require __DIR__ . '/index.php';
    return true;
}

$relative = rawurldecode($uri);
if (strpos($relative, '..') !== false) {
    http_response_code(400);
    echo 'Bad path';
    return true;
}
$file = $root . $relative;
if (is_file($file)) {
    return false;
}

http_response_code(404);
header('Content-Type: text/html; charset=UTF-8');
echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not in this preview</title></head><body><h1>This preview serves the tools engine.</h1><p>Hosting, cart and client-area pages render through WHMCS and are not replaced with mock data.</p><p><a href="/tools">Open CloudHost247 Tools</a></p></body></html>';
return true;
