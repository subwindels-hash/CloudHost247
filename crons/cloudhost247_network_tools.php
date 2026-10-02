<?php
/**
 * CloudHost247 Network Tools — scheduled work on the existing WHMCS cron.
 *
 * One pass does four bounded jobs:
 *   1. resolver health  (every resolver_health_interval_minutes, default 15)
 *   2. provider health  (every provider_health_interval_minutes, default 30)
 *   3. due monitors     (customer monitors: DNS change, SSL expiry, email config)
 *   4. retention        (expired cache rows and execution history)
 *
 * It only ever records what a real check returned. A check that cannot run is
 * recorded as NOT_CHECKED / UNKNOWN, never as healthy. Exit codes: 0 success,
 * 1 fatal, 2 finished with failures (the cron can alert on that).
 *
 * Usage: php crons/cloudhost247_network_tools.php [--force-health]
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

$root = dirname(__DIR__);
require $root . '/init.php';
require_once $root . '/modules/addons/cloudhost247_network_tools/bootstrap.php';

use CloudHost247\NetworkTools\Core\Repository\CacheRepository;
use CloudHost247\NetworkTools\Core\Repository\ExecutionLogRepository;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;
use CloudHost247\NetworkTools\Core\Repository\ToolStateRepository;
use CloudHost247\NetworkTools\Core\Registry\ToolRegistry;
use CloudHost247\NetworkTools\Services\Shared\HealthChecker;
use CloudHost247\NetworkTools\Services\Shared\MonitorRunner;
use WHMCS\Database\Capsule;

function ch247_nt_cron_module_active()
{
    try {
        return (bool) Capsule::table('tbladdonmodules')->where('module', 'cloudhost247_network_tools')->exists();
    } catch (\Throwable $unavailable) {
        return false;
    }
}

function ch247_nt_cron_due($settingMinutes, $lastRunKey)
{
    $minutes = max(5, (int) $settingMinutes);
    $last = (int) Capsule::table('mod_cloudhost247_nt_settings')->where('setting_key', $lastRunKey)->value('setting_value');
    return (time() - $last) >= $minutes * 60;
}

function ch247_nt_cron_mark($lastRunKey)
{
    try {
        Capsule::table('mod_cloudhost247_nt_settings')->updateOrInsert(
            array('setting_key' => $lastRunKey),
            array('setting_value' => (string) time(), 'updated_at' => date('Y-m-d H:i:s'))
        );
    } catch (\Throwable $unavailable) {
        // A missing marker only means the next pass re-runs the check.
    }
}

try {
    if (!ch247_nt_cron_module_active()) {
        fwrite(STDERR, 'CloudHost247 Network Tools is not activated.' . PHP_EOL);
        exit(1);
    }
    $settings = new SettingsRepository();
    if (defined('CH247_NETWORK_TOOLS_VERSION') === false) {
        fwrite(STDERR, 'The module bootstrap did not load correctly.' . PHP_EOL);
        exit(1);
    }
    $force = in_array('--force-health', array_slice($argv, 1), true);
    $summary = array('resolvers' => null, 'providers' => null, 'monitors' => null, 'retention' => null, 'failures' => 0);

    if (!$settings->bool('enabled')) {
        fwrite(STDOUT, json_encode(array('skipped' => 'The tools platform is disabled in the module settings.', 'summary' => $summary)) . PHP_EOL);
        exit(0);
    }

    // Keep the tool registry table in step with code additions on every pass.
    $definitions = array();
    foreach (ToolRegistry::all() as $definition) {
        $definitions[$definition->slug()] = $definition->toArray();
    }
    (new ToolStateRepository())->seed($definitions);

    $checker = new HealthChecker(null, null, $settings);
    $resolverDue = $force || ch247_nt_cron_due($settings->int('resolver_health_interval_minutes', 15), 'cron_resolver_health_at');
    $providerDue = $force || ch247_nt_cron_due($settings->int('provider_health_interval_minutes', 30), 'cron_provider_health_at');
    if ($resolverDue) {
        $resolverResult = $checker->run(true, false);
        $summary['resolvers'] = (int) $resolverResult['checked'] . ' checked, ' . (int) $resolverResult['healthy'] . ' healthy, ' . (int) $resolverResult['failed'] . ' failed';
        $summary['failures'] += (int) $resolverResult['failed'];
        ch247_nt_cron_mark('cron_resolver_health_at');
    } else {
        $summary['resolvers'] = 'not due';
    }
    if ($providerDue) {
        $providerResult = $checker->run(false, true);
        $summary['providers'] = (int) $providerResult['checked'] . ' checked, ' . (int) $providerResult['healthy'] . ' healthy, ' . (int) $providerResult['failed'] . ' failed, ' . (int) $providerResult['unknown'] . ' unknown';
        $summary['failures'] += (int) $providerResult['failed'];
        ch247_nt_cron_mark('cron_provider_health_at');
    } else {
        $summary['providers'] = 'not due';
    }

    if ($settings->bool('monitoring_enabled')) {
        $monitors = (new MonitorRunner(null, $settings))->runDue(25);
        $summary['monitors'] = $monitors['skipped'] !== ''
            ? $monitors['skipped']
            : (int) $monitors['checked'] . ' checked, ' . (int) $monitors['changed'] . ' changed, ' . (int) $monitors['failed'] . ' failed, ' . (int) $monitors['unknown'] . ' not checked';
        $summary['failures'] += (int) $monitors['failed'];
    } else {
        $summary['monitors'] = 'monitoring disabled';
    }

    $cache = new CacheRepository();
    $cachePruned = $cache->flush();
    $history = new ExecutionLogRepository();
    $historyPruned = $history->prune($settings->int('history_retention_days', 90));
    $summary['retention'] = 'cache rows removed: ' . (int) $cachePruned . ', execution rows removed: ' . (int) $historyPruned;
    $summary['checked_at'] = gmdate('c');

    fwrite(STDOUT, json_encode($summary) . PHP_EOL);
    exit($summary['failures'] > 0 ? 2 : 0);
} catch (\Throwable $error) {
    fwrite(STDERR, 'CloudHost247 Network Tools cron failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
