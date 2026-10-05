<?php
/**
 * CloudHost247 — Coming Soon. A professional holding page, no fake dates.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = '
    <section class="section">
      <div class="container" style="max-width:760px;text-align:center;padding-top:48px;padding-bottom:48px">
        <span class="eyebrow">CloudHost247</span>
        <h1>Something new is on the way</h1>
        <p class="muted">This section of the site is being prepared. We publish things when they are genuinely ready — not before. In the meantime, everything that is live today is listed below.</p>
        <div class="hero-ctas" style="justify-content:center;margin-top:22px">
          <a class="btn btn--primary" href="index.php">Back to Homepage</a>
          <a class="btn btn--secondary" href="offers.php">View Current Offers</a>
        </div>
      </div>
    </section>';

echo ch247_page([
    'title' => 'Coming Soon | CloudHost247',
    'description' => 'This CloudHost247 page is being prepared. Explore what is live today.',
    'canonical' => 'comingsoon.php',
    'noindex' => true,
    'active' => '',
    'crumbs' => [['index.php', 'Home'], [null, 'Coming Soon']],
], $content);
