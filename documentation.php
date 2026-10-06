<?php
/**
 * Documentation — public route.
 *
 * Renders the published theme entry. Editorial fallback covers the route
 * until an administrator publishes a replacement. Prices and availability
 * still come only from the product catalog.
 */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';

\CloudHost247\Theme\PublicPage::route(new \WHMCS\ClientArea(), 'documentation', 'Documentation');
