#!/usr/bin/env php
<?php
/**
 * Website Builder maintenance.
 *
 * Two jobs, both safe to run as often as you like:
 *
 *   1. flip scheduled pages whose publication time has passed, so the Pages
 *      list and the status badges match reality;
 *   2. delete expired draft preview tokens.
 *
 * Scheduled publication does not depend on this cron. The public resolver
 * checks the publication time itself, so a page never goes live early and
 * never goes live late because a job did not run; this task only keeps the
 * stored status honest.
 *
 * Usage: php crons/cloudhost247_builder.php [--dry-run]
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This maintenance task may only be run from the command line.\n");
}

$root = dirname(__DIR__);
$init = $root . '/init.php';
if (!is_file($init)) {
    fwrite(STDERR, "WHMCS init.php was not found at " . $init . ".\n");
    exit(1);
}
require $init;

$bootstrap = $root . '/modules/addons/cloudhost247_builder/bootstrap.php';
if (!is_file($bootstrap)) {
    fwrite(STDERR, "The Website Builder module is not installed.\n");
    exit(1);
}
require_once $bootstrap;

$dryRun = in_array('--dry-run', $argv, true);

try {
    $pages = new \CloudHost247\Builder\Services\PageService();
    $repository = $pages->repository();

    $due = $repository->dueScheduled();
    if ($dryRun) {
        foreach ($due as $page) {
            echo 'Would publish: ' . $page['slug'] . ' (scheduled for ' . $page['publish_at'] . ')' . PHP_EOL;
        }
        echo 'Dry run: ' . count($due) . ' scheduled page(s) are due; no changes were made.' . PHP_EOL;
        exit(0);
    }

    $promoted = $pages->promoteScheduled(0);
    foreach ($promoted as $slug) {
        echo 'Published scheduled page: ' . $slug . PHP_EOL;
    }

    $purged = $repository->purgeExpiredTokens();
    echo 'Scheduled pages published: ' . count($promoted) . '. Expired preview tokens removed: ' . $purged . '.' . PHP_EOL;
    exit(0);
} catch (\Throwable $error) {
    fwrite(STDERR, 'Website Builder maintenance failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
