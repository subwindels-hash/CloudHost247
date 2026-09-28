<?php
/**
 * Phone Services - standalone cron runner.
 *
 * Use this when you want the telecom lifecycle to run on its own schedule
 * rather than piggy-backing on the WHMCS system cron:
 *
 *   * /5 * * * *  php /path/to/whmcs/modules/addons/phoneservices/cron/run.php frequent
 *   17 2 * * *    php /path/to/whmcs/modules/addons/phoneservices/cron/run.php daily
 *
 * CLI only - refuses to run over HTTP.
 *
 * @package PhoneServices
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This script may only be run from the command line.\n");
}

$whmcsRoot = dirname(__DIR__, 3);

if (!is_file($whmcsRoot . '/init.php')) {
    fwrite(STDERR, "Unable to locate WHMCS init.php (expected {$whmcsRoot}/init.php).\n");
    exit(1);
}

require_once $whmcsRoot . '/init.php';
require_once __DIR__ . '/../bootstrap.php';

use PhoneServices\Core\Logger;
use PhoneServices\Services\Cron;

$mode = strtolower((string) ($argv[1] ?? 'daily'));

if (!in_array($mode, ['daily', 'frequent'], true)) {
    fwrite(STDERR, "Usage: run.php [daily|frequent]\n");
    exit(1);
}

$started = microtime(true);

try {
    $cron = new Cron();
    $summary = $mode === 'daily' ? $cron->runDaily() : $cron->runFrequent();

    $summary['duration_seconds'] = round(microtime(true) - $started, 2);

    Logger::info('Cron run completed (' . $mode . ')', $summary);

    echo 'PhoneServices ' . $mode . " run complete:\n";
    foreach ($summary as $key => $value) {
        echo '  - ' . str_pad($key, 22) . $value . "\n";
    }

    exit(0);
} catch (\Throwable $e) {
    Logger::exception($e, 'Cron runner (' . $mode . ')');
    fwrite(STDERR, 'Cron run failed: ' . $e->getMessage() . "\n");
    exit(1);
}
