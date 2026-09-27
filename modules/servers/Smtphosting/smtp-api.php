<?php

header('Content-Type: application/json');
ini_set('display_errors', 0);

$remote_ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$limit = 100;
$period = 300;

if (function_exists('apcu_fetch')) {
    $key = 'rate_' . $remote_ip;
    $data = apcu_fetch($key) ?: ['count'=>0, 'ts'=>time()];
    if (time() - $data['ts'] > $period) {
        $data = ['count'=>1, 'ts'=>time()];
    } else {
        $data['count']++;
    }
    if ($data['count'] > $limit) {
        http_response_code(429);
        echo json_encode(['status'=>'error','msg'=>'Rate limit exceeded']);
        exit;
    }
    apcu_store($key, $data, $period);
} else {
    $file = sys_get_temp_dir() . '/rate_' . md5($remote_ip);
    $data = @json_decode(@file_get_contents($file), true) ?: ['count'=>0,'ts'=>time()];
    if (time() - $data['ts'] > $period) {
        $data = ['count'=>1,'ts'=>time()];
    } else {
        $data['count']++;
    }
    if ($data['count'] > $limit) {
        http_response_code(429);
        echo json_encode(['status'=>'error','msg'=>'Rate limit exceeded']);
        exit;
    }
    file_put_contents($file, json_encode($data));
}

$fn = $_GET['fn'] ?? '';
$user_name = trim($_GET['user_name'] ?? '');
$main_domain = trim($_GET['main_domain'] ?? '');
$page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
$per_page = isset($_GET['per_page']) ? (int)$_GET['per_page'] : 10;
$incoming_secret = $_GET['secret'] ?? '';

$map = [
    'usage' => [
        'url' => 'https://my.smtphosting.com/smtp/mail-usage-log.php',
        'secret' => 'lmjHzI2OR1cxk8DAehvhxtN5it5YutZwX5B3'
    ],
    'logs' => [
        'url' => 'https://my.smtphosting.com/smtp/mail-sent-log.php',
        'secret' => 'tiWlB6R1PlyKXUJICSm4tVrdOxVuFgAQOKnJ'
    ]
];

if (!isset($map[$fn])) {
    http_response_code(400);
    echo json_encode(['status'=>'error','msg'=>'Invalid fn']);
    exit;
}

// verify secret
if ($incoming_secret !== $map[$fn]['secret']) {
    http_response_code(403);
    echo json_encode(['status'=>'error','msg'=>'Invalid secret']);
    exit;
}

// build query
$query = [
    'secret' => $map[$fn]['secret'],
    'user_name' => $user_name,
    'main_domain' => $main_domain
];

if ($fn === 'logs') {
    $query['page'] = $page;
    $query['per_page'] = $per_page;
}

$url = $map[$fn]['url'] . '?' . http_build_query($query);

// fetch
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 8);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 4);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

$response = curl_exec($ch);
$httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($httpcode ?: 200);
echo $response;
?>