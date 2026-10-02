<?php
/**
 * Page Not Found — public 404 route.
 *
 * Always answers 404. When a published "page-not-found" entry exists the
 * operator's wording is shown in place of the built-in explanation.
 */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';

\CloudHost247\Theme\PublicPage::notFound(new \WHMCS\ClientArea());
