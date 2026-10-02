<?php
/**
 * Dedicated Servers — public route.
 *
 * Renders the published "dedicated-server" entry from the independent theme content store
 * (Theme Manager). It no longer hands the page to the vendor legacy theme shell,
 * so the route works without the encoded theme-helper addon and without anyone
 * assigning blocks in it. Until an entry is published the page answers 404 with
 * a plain explanation instead of a placeholder.
 */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';

\CloudHost247\Theme\PublicPage::route(new \WHMCS\ClientArea(), 'dedicated-server', 'Dedicated Servers');
