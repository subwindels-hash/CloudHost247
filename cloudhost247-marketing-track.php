<?php
/**
 * CloudHost247 Marketing — public tracking endpoint.
 *
 * Serves the email-marketing tracking pixel, click redirect and unsubscribe
 * confirmation. This is functional infrastructure and is preserved exactly:
 * it runs when the WHMCS core and the marketing addon are installed, and
 * answers a plain 404 otherwise. No address, campaign name or subscriber
 * identifier is ever accepted or returned.
 */

declare(strict_types=1);

$init = __DIR__ . '/init.php';
$bootstrap = __DIR__ . '/modules/addons/cloudhost247_marketing/bootstrap.php';

if (!is_file($init) || !is_file($bootstrap)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Not found');
}

require_once $init;
require __DIR__ . '/legacy-marketing-router.php';
