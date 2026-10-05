<?php
/**
 * Legacy theme-CMS front controller. The theme content store it rendered was
 * part of the retired WHMCS layer, so this route now answers a clean 404 and
 * points visitors at the live site instead of a blank page.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

http_response_code(404);
echo ch247_page([
    'title' => 'Page Not Found | CloudHost247',
    'description' => 'The page you requested is no longer available.',
    'canonical' => 'notfound.php',
    'noindex' => true,
    'active' => '',
    'crumbs' => [['index.php', 'Home'], [null, 'Not Found']],
], ch247_page_head([['index.php', 'Home'], [null, 'Not Found']], 'Page not found', 'This page was part of an older version of our site and is no longer published.')
    . '<section class="section"><div class="container">'
    . ch247_notice('Looking for something specific? Try the <a href="index.php">homepage</a>, browse <a href="offers.php">current offers</a>, or visit the <a href="help-center.php">Help Center</a>.')
    . '</div></section>');
