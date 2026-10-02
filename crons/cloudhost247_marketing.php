<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }

/**
 * CloudHost247 Marketing — delivery worker.
 *
 * Recommended schedule (every minute, or the shortest interval your host offers):
 *   php -q /path/to/whmcs/crons/cloudhost247_marketing.php
 *   php -q /path/to/whmcs/crons/cloudhost247_marketing.php --campaign=42 --dry-run
 *
 * One pass does the whole delivery path, bounded by the module's settings:
 * stale locks are released, due campaigns are frozen into recipient rows,
 * recipients are queued, due automation steps are advanced onto the same queue,
 * an allowance of messages is attempted through the configured cPanel SMTP
 * provider, and drained campaigns are closed. Every step is idempotent, so a run
 * that is interrupted (or overlapped with another worker) sends a message at
 * most once and never loses one.
 *
 * Automation runs advance one step per pass: a journey with two send steps takes
 * two passes, not one loop.
 *
 * Options:
 *   --campaign=N   work on one campaign only
 *   --dry-run      resolve, freeze and queue, but never talk to the relay
 *
 * Exit codes: 0 the pass completed (even if some messages failed — see the
 * summary), 1 the pass could not run at all.
 */

$root = dirname(__DIR__);
require $root . '/init.php';
require_once $root . '/modules/addons/cloudhost247_marketing/bootstrap.php';

$options = array('worker' => 'cron-' . getmypid());
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--dry-run') { $options['dry_run'] = true; continue; }
    if (strpos($argument, '--campaign=') === 0) {
        $options['campaign_id'] = (int) substr($argument, 11);
        continue;
    }
}

try {
    $worker = new \CloudHost247\Marketing\Services\QueueService();
    $summary = $worker->run($options);
    fwrite(STDOUT, 'CloudHost247 Marketing delivery: ' . json_encode($summary) . PHP_EOL);
    exit(0);
} catch (\Throwable $error) {
    fwrite(STDERR, 'CloudHost247 Marketing delivery failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
