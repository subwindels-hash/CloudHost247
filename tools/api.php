<?php
/**
 * Public tools API. No credentials are read from the request for storage.
 * Browser-only tools are rejected so passwords and card numbers never land here.
 */
require __DIR__ . '/lib/bootstrap.php';

use CloudHost247\Tools\Catalog;
use CloudHost247\Tools\Engine;
use CloudHost247\Tools\Guard;
use CloudHost247\Tools\View;

if (PHP_SAPI === 'cli') {
    $slug = isset($argv[1]) ? $argv[1] : '';
    $raw = stream_get_contents(STDIN);
    $input = json_decode($raw ? $raw : '{}', true);
    $result = Engine::run($slug, is_array($input) ? $input : array(), array('ip' => '203.0.113.10'));
    echo json_encode($result), "\n";
    exit(empty($result['ok']) ? 1 : 0);
}

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

$op = isset($_GET['op']) ? $_GET['op'] : '';
if ($op === 'catalog') {
    header('Content-Type: application/json; charset=UTF-8');
    $tools = array();
    foreach (Catalog::enabledTools() as $tool) {
        $tools[] = array(
            'slug' => $tool['slug'], 'name' => $tool['name'], 'category' => $tool['category'],
            'categoryLabel' => $tool['categoryLabel'], 'summary' => $tool['summary'], 'path' => $tool['path'],
            'keywords' => $tool['keywords'], 'badge' => $tool['badge'], 'mode' => $tool['mode'], 'featured' => $tool['featured'],
        );
    }
    echo json_encode(array('categories' => Catalog::categories(), 'tools' => $tools));
    exit;
}

if ($op === 'speed') {
    $bytes = isset($_GET['bytes']) ? (int) $_GET['bytes'] : 200000;
    $bytes = max(1024, min(2000000, $bytes));
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . $bytes);
    $chunk = random_bytes(1024);
    $left = $bytes;
    while ($left > 0) {
        $piece = substr($chunk, 0, min(1024, $left));
        echo $piece;
        $left -= strlen($piece);
    }
    exit;
}

if ($op === 'upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input', false, null, 0, 2000001);
    if (strlen($raw) > 2000000) {
        http_response_code(413);
        header('Content-Type: application/json');
        echo json_encode(array('ok' => false, 'error' => 'Upload is limited to 2 MB.'));
        exit;
    }
    header('Content-Type: application/json');
    echo json_encode(array('ok' => true, 'bytes' => strlen($raw)));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo 'Method not allowed';
    exit;
}

$length = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
if ($length > Guard::MAX_BODY) {
    http_response_code(413);
    header('Content-Type: application/json');
    echo json_encode(array('ok' => false, 'error' => 'Request is too large.'));
    exit;
}

$contentType = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
if (stripos($contentType, 'application/json') !== false) {
    $payload = json_decode(file_get_contents('php://input'), true);
    $slug = is_array($payload) && isset($payload['slug']) ? $payload['slug'] : '';
    $input = is_array($payload) && isset($payload['input']) && is_array($payload['input']) ? $payload['input'] : array();
    $format = 'json';
} else {
    $slug = isset($_POST['slug']) ? $_POST['slug'] : '';
    $input = $_POST;
    unset($input['slug'], $input['format'], $input['options']);
    $format = isset($_POST['format']) ? $_POST['format'] : 'html';
}

if (!is_string($slug) || !preg_match('/^[a-z0-9-]{1,80}$/', $slug)) {
    http_response_code(400);
    echo json_encode(array('ok' => false, 'error' => 'Unknown tool.'));
    exit;
}

$result = Engine::run($slug, $input, array('ip' => Guard::clientIp()));
$status = empty($result['ok']) && isset($result['status']) ? (int) $result['status'] : (empty($result['ok']) ? 400 : 200);
http_response_code($status);
if ($format === 'html') {
    header('Content-Type: text/html; charset=UTF-8');
    $tool = Catalog::find($slug);
    $title = $tool ? $tool['name'] : 'Tool';
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
        . View::e($title) . '</title><link rel="stylesheet" href="/templates/cloudhost247/css/site.css"><link rel="stylesheet" href="/templates/cloudhost247/css/tools.css"></head><body class="ch-site"><main class="ch-wrap ch-section"><p><a href="/tools/'
        . View::e($slug) . '">Back</a></p>' . View::resultHtml($result) . '</main></body></html>';
    exit;
}
header('Content-Type: application/json; charset=UTF-8');
echo json_encode($result);
