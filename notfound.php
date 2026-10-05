<?php
/**
 * CloudHost247 — 404 page. Always answers with a real 404 status.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

http_response_code(404);

$content = '
    <section class="section">
      <div class="container" style="max-width:760px;padding-top:48px;padding-bottom:48px">
        <span class="eyebrow">Error 404</span>
        <h1>Page not found</h1>
        <p class="muted">The page you requested does not exist — it may have moved, been renamed, or never existed at all.</p>
        <div class="grid grid--3 mt-2">
          <div class="card"><h3>Homepage</h3><p>Start from the beginning.</p><a class="btn btn--secondary" href="index.php">Go Home</a></div>
          <div class="card"><h3>Current offers</h3><p>See every live plan and price.</p><a class="btn btn--secondary" href="offers.php">View Offers</a></div>
          <div class="card"><h3>Help Center</h3><p>Guides, FAQs and support.</p><a class="btn btn--secondary" href="help-center.php">Get Help</a></div>
        </div>
      </div>
    </section>';

echo ch247_page([
    'title' => 'Page Not Found | CloudHost247',
    'description' => 'The page you requested could not be found.',
    'canonical' => 'notfound.php',
    'noindex' => true,
    'active' => '',
    'crumbs' => [['index.php', 'Home'], [null, 'Not Found']],
], $content);
