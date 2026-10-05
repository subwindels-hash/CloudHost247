<?php
/**
 * CloudHost247 — WordPress Hosting. Plans and pricing are live from the catalog.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'WordPress Hosting']],
    'WordPress Hosting',
    'Optimized hosting for WordPress websites with security, performance and automated management.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>WordPress, without the maintenance burden</h2></div>
        <p class="muted" style="max-width:760px">A WordPress-tuned stack with hardened defaults and performance caching — so you publish content while the platform handles the plumbing. Plans appear here the moment they are published in our catalog.</p>
        <div class="mt-2">' . ch247_plan_cards('wordpress', 'WordPress plans have not been published yet. Until they are, our Web Hosting plans run WordPress comfortably — or ask us for a recommendation.') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Built in</span><h2>What WordPress hosting covers</h2></div>
        ' . ch247_feature_grid([
            ['Optimized stack', 'PHP and database settings tuned for WordPress workloads.'],
            ['Security-first defaults', 'Hardened configuration and free SSL on every site.'],
            ['Automatic updates', 'Core updates handled so your site stays current and safe.'],
            ['Performance caching', 'Page caching for faster loads on repeat visits.'],
            ['Staging-friendly workflow', 'Make changes confidently with backup and restore.'],
            ['Expert support', 'Real engineers who know WordPress, via tickets.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Launch your WordPress site', 'Pick a plan, install WordPress in one click and start publishing.', 'Choose a Plan', CH247_APP_BASE . '/app/catalog?product=wordpress');

echo ch247_page([
    'title' => 'WordPress Hosting — Optimized & Managed | CloudHost247',
    'description' => 'Optimized WordPress hosting with security, performance and automated management on the CloudHost247 platform.',
    'canonical' => 'wordpress-hosting.php',
    'active' => 'hosting',
    'crumbs' => [['index.php', 'Home'], [null, 'WordPress Hosting']],
], $content);
