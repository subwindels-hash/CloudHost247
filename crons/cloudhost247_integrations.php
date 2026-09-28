<?php
/**
 * Scheduled health verification for every enabled integration in the active
 * environment. Results are the real provider outcome; nothing is simulated.
 *
 * Usage: php crons/cloudhost247_integrations.php [environment]
 */
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }

$root = dirname(__DIR__);
require $root . '/init.php';
require_once $root . '/modules/addons/cloudhost247_integrations/bootstrap.php';

try {
    $environment = isset($argv[1]) && $argv[1] !== ''
        ? \CloudHost247\Integrations\Support\Environment::assert($argv[1])
        : \CloudHost247\Integrations\Support\Environment::active();
    if (!\CloudHost247\Integrations\Services\IntegrationManager::installed()) {
        fwrite(STDERR, 'CloudHost247 API & Integrations is not activated.' . PHP_EOL);
        exit(1);
    }
    $repository = \CloudHost247\Integrations\Services\IntegrationManager::repository();
    $summary = array('environment' => $environment, 'checked' => 0, 'connected' => 0, 'failed' => 0, 'results' => array());
    foreach ($repository->all($environment) as $row) {
        if ((int) $row->enabled !== 1) { continue; }
        $result = \CloudHost247\Integrations\Services\IntegrationManager::test((int) $row->id);
        $summary['checked']++;
        if (\CloudHost247\Integrations\Support\ResultCode::isSuccess($result['code'])) { $summary['connected']++; } else { $summary['failed']++; }
        $summary['results'][(string) $row->provider_key] = array(
            'result_code' => $result['code'],
            'latency_ms' => isset($result['latency_ms']) ? (int) $result['latency_ms'] : 0,
            'correlation_id' => isset($result['correlation_id']) ? $result['correlation_id'] : '',
        );
    }
    fwrite(STDOUT, json_encode($summary) . PHP_EOL);
    exit($summary['failed'] > 0 ? 2 : 0);
} catch (\Throwable $error) {
    fwrite(STDERR, 'Integration health verification failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
