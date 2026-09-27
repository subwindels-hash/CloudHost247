<?php
$root = dirname(__DIR__, 2);
require_once $root . '/modules/addons/cloudhost247_core/lib/Contracts/Migration.php';
require_once $root . '/modules/addons/cloudhost247_core/lib/Security/SecretPolicy.php';
require_once $root . '/modules/addons/cloudhost247_core/lib/Support/Logger.php';
require_once $root . '/modules/addons/cloudhost247_core/lib/Support/HealthCheck.php';
require_once $root . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';

use CloudHost247\Foundation\Security\SecretPolicy;
use CloudHost247\Foundation\Support\Logger;
use CloudHost247\Foundation\Support\HealthCheck;

$tests = array();
$tests['recursive secret redaction'] = function () {
    $safe = SecretPolicy::redact(array('user' => 'alice', 'api_key' => 'secret', 'nested' => array('consumerKey' => 'abc', 'ok' => 7)));
    return $safe['user'] === 'alice' && $safe['api_key'] === '[REDACTED]' && $safe['nested']['consumerKey'] === '[REDACTED]' && $safe['nested']['ok'] === 7;
};
$tests['correlation IDs are random hex'] = function () {
    $a = Logger::correlationId(); $b = Logger::correlationId();
    return $a !== $b && preg_match('/^[a-f0-9]{32}$/', $a) === 1;
};
$tests['health check shape'] = function () {
    $result = HealthCheck::run();
    return isset($result['php_supported'], $result['whmcs_loaded'], $result['openssl_available']);
};
$tests['replacement module entry points exist'] = function () use ($root) {
    foreach (array('theme', 'currency', 'ovh') as $name) if (!is_file($root . '/modules/addons/cloudhost247_' . $name . '/cloudhost247_' . $name . '.php')) return false;
    return true;
};

$tests['theme sanitizer removes executable attributes'] = function () {
    $repository = new \CloudHost247\Theme\ThemeRepository();
    $method = new ReflectionMethod($repository, 'sanitizeHtml'); $method->setAccessible(true);
    $safe = $method->invoke($repository, '<p onclick="alert(1)">Safe</p><script>alert(2)</script><a href="javascript:bad">bad</a>');
    return strpos($safe, 'onclick') === false && strpos($safe, '<script') === false && strpos($safe, 'javascript:') === false && strpos($safe, 'Safe') !== false;
};

$failed = 0;
foreach ($tests as $name => $test) {
    try { $ok = $test(); } catch (Throwable $e) { $ok = false; echo "not ok - $name: {$e->getMessage()}\n"; $failed++; continue; }
    echo ($ok ? 'ok' : 'not ok') . " - $name\n"; if (!$ok) $failed++;
}
exit($failed ? 1 : 0);
