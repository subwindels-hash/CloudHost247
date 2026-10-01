<?php
/**
 * CloudHost247 Email Hosting - WHMCS hooks.
 *
 * Only two responsibilities:
 *   1. run the bounded reconciler from the WHMCS daily cron, so no separate
 *      system cron entry is required for a basic installation;
 *   2. keep the client-area assets available on the service page.
 *
 * Nothing here performs a provider API call during page rendering.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Email\Database\Migrator;
use CloudHost247\Email\Service\Reconciler;
use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Webhook\Verifier;
use WHMCS\Database\Capsule;

/**
 * Daily: synchronise a bounded batch of accounts and prune old records.
 */
add_hook('DailyCronJob', 1, function () {
    try {
        // Only do work when the module is actually in use.
        $servers = Capsule::table('tblservers')->where('type', 'cloudhost247_email_hosting')->count();

        if ($servers === 0) {
            return;
        }

        Migrator::ensureSchema();

        (new Reconciler())->run(50, 20, 360);

        Logger::prune(90);
        Verifier::prune(30);
    } catch (\Throwable $e) {
        Logger::error('cron.daily_failed', ['error' => $e->getMessage()]);
    }
});

/**
 * Five-minute cron (WHMCS 8.x): a small, strictly bounded catch-up pass so
 * uncertain operations are reconciled quickly rather than waiting a day.
 */
add_hook('AfterCronJob', 1, function () {
    try {
        $servers = Capsule::table('tblservers')->where('type', 'cloudhost247_email_hosting')->count();

        if ($servers === 0) {
            return;
        }

        (new Reconciler())->run(10, 5, 720);
    } catch (\Throwable $e) {
        Logger::error('cron.after_failed', ['error' => $e->getMessage()]);
    }
});

/**
 * Client-area stylesheet for the service overview template.
 *
 * @return string
 */
add_hook('ClientAreaHeadOutput', 1, function ($vars) {
    $filename = isset($vars['filename']) ? (string) $vars['filename'] : '';

    if ($filename !== 'clientarea' && $filename !== 'clientareaproductdetails') {
        return '';
    }

    return '<link rel="stylesheet" href="modules/servers/cloudhost247_email_hosting/templates/assets/clientarea.css">';
});
