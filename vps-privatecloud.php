<?php
/**
 * VPS Private Cloud — public route.
 *
 * Renders the published "vps-privatecloud" entry from the independent theme content store
 * (Theme Manager). When the entry names a WHMCS product group, the page also
 * lists that group's products through the page builder's bounded read-only
 * catalogue reader. It no longer hands the page to the vendor legacy theme shell
 * or reads the vendor content tables, so the route works without the encoded
 * theme-helper addon. Until an entry is published the page answers 404 with a
 * plain explanation instead of a placeholder.
 */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';

\CloudHost247\Theme\PublicPage::route(new \WHMCS\ClientArea(), 'vps-privatecloud', 'VPS Private Cloud');
