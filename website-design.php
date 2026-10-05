<?php
/**
 * CloudHost247 — Website Design services. Honest positioning: bespoke work,
 * quoted per project — no invented portfolios or testimonials.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Website Design']],
    'Website Design',
    'Professional websites designed and built for your business — scoped per project, quoted before any work begins.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Service</span><h2>A website that earns its keep</h2></div>
        <p class="muted" style="max-width:760px">We design and build professional websites: business sites, landing pages and content-driven builds — always mobile-first, fast and easy for you to maintain. Every project starts with a conversation and a written quote; we do not publish invented portfolios or fake client logos.</p>
        <div class="grid grid--3 mt-2">
          <div class="card"><h3>1. Discovery</h3><p>We learn your goals, audience and content — then propose a structure and timeline.</p></div>
          <div class="card"><h3>2. Design & build</h3><p>Designs are reviewed with you before build; the site is assembled on professional hosting.</p></div>
          <div class="card"><h3>3. Launch & care</h3><p>We launch, hand over access, and stay available for updates, content changes and growth.</p></div>
        </div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Included</span><h2>What a design project covers</h2></div>
        ' . ch247_feature_grid([
            ['Mobile-first layout', 'Designed for phones first, then scaled up to desktop.'],
            ['Performance', 'Fast loads through lean markup and optimized assets.'],
            ['SEO foundations', 'Clean structure, metadata and sitemaps from day one.'],
            ['Content guidance', 'Help shaping the words so the site actually sells.'],
            ['Hosting included', 'Your site runs on CloudHost247 hosting — one provider, one bill.'],
            ['Post-launch support', 'Changes and additions handled through support tickets.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Start a design conversation', 'Tell us about your business and goals — we will reply with a realistic scope and quote.', 'Contact Support', 'help-center.php');

echo ch247_page([
    'title' => 'Website Design — Professional Builds | CloudHost247',
    'description' => 'Professional website design and build services from CloudHost247: mobile-first, fast, and quoted per project before work begins.',
    'canonical' => 'website-design.php',
    'active' => 'business',
    'crumbs' => [['index.php', 'Home'], [null, 'Website Design']],
], $content);
