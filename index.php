<?php
/**
 * CloudHost247 — homepage (PHP front).
 *
 * Shares the platform design system. Every price and service shown here is
 * pulled live from the CloudHost247 catalog API; when the API is unreachable
 * the page says so rather than inventing numbers.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$catalog = ch247_catalog();
$extensions = ch247_extensions();
$appBase = ch247_e(CH247_APP_BASE);

/* Domain search band: extension pills from the live registry configuration. */
$tldPills = '';
if (is_array($extensions)) {
    foreach (array_slice($extensions, 0, 8) as $ext) {
        $tld = ch247_e($ext['tld'] ?? '');
        $price = isset($ext['registerPriceCents']) && is_numeric($ext['registerPriceCents'])
            ? ch247_money(((float) $ext['registerPriceCents']) / 100, 'USD')
            : '';
        $tldPills .= '<li><b>.' . $tld . '</b>' . ($price !== '' ? ' <span class="muted">' . ch247_e($price) . '/yr</span>' : '') . '</li>';
    }
}

/* Service cards. */
$services = [
    ['web-hosting.php', 'Web Hosting', 'Reliable hosting for personal websites, businesses and professional websites.'],
    ['wordpress-hosting.php', 'WordPress Hosting', 'Optimized hosting for WordPress with security, performance and automated management.'],
    ['vps-hosting.php', 'VPS Hosting', 'Dedicated virtual resources with greater control, performance and flexibility.'],
    ['dedicated-server.php', 'Dedicated Servers', 'High-performance physical infrastructure for demanding workloads.'],
    ['email-hosting.php', 'Business Email', 'Professional mailboxes on your own domain, with webmail and mobile access.'],
    ['domain.php', 'Domains', 'Search, register, transfer and renew domains with transparent pricing.'],
];
$serviceCards = '';
foreach ($services as [$href, $title, $text]) {
    $serviceCards .= '<article class="card"><h3>' . ch247_e($title) . '</h3><p>' . ch247_e($text) . '</p>'
        . '<a class="btn btn--ghost" href="' . ch247_e($href) . '">Learn more</a></article>';
}

/* Live offers: the first published plans across the catalog, with real prices. */
$offerCards = '';
if (is_array($catalog) && !empty($catalog['products'])) {
    $shown = 0;
    foreach ($catalog['products'] as $product) {
        foreach ($product['plans'] ?? [] as $plan) {
            if ($shown >= 4) {
                break 2;
            }
            $pricing = $plan['pricing'] ?? [];
            if (!$pricing) {
                continue;
            }
            $entry = $pricing[0];
            $cycle = $entry['billingCycle'] ?? '';
            $suffix = $cycle === 'monthly' ? '/month' : ($cycle === 'annual' ? '/year' : '');
            $offerCards .= '<article class="card plan-card"><div class="plan-body">'
                . '<span class="badge">' . ch247_e($product['name'] ?? 'Service') . '</span>'
                . '<h3 style="margin-top:12px">' . ch247_e($plan['name'] ?? 'Plan') . '</h3>'
                . '<p style="font-size:1.7rem;font-weight:800;margin:8px 0 2px">'
                . ch247_e(ch247_money($entry['price'] ?? null, $entry['currency'] ?? 'USD'))
                . ' <span style="font-size:.9rem;font-weight:600;color:var(--ink-500)">' . ch247_e($suffix) . '</span></p>'
                . '</div><a class="btn btn--primary" href="' . $appBase . '/app/catalog?product=' . ch247_e($product['slug'] ?? '') . '">Choose Plan</a></article>';
            $shown += 1;
        }
    }
}

$trustItems = [
    ['Fast', 'Modern storage and runtimes tuned for speed.'],
    ['Secure', 'Encryption-first defaults across the platform.'],
    ['Reliable', 'Engineered for continuity, monitored honestly.'],
    ['Global', 'Built to serve customers worldwide.'],
    ['Scalable', 'Grow from a single site to full infrastructure.'],
    ['Professional', 'Serious tooling for serious work.'],
];
$trustHtml = '';
foreach ($trustItems as [$label, $text]) {
    $trustHtml .= '<div class="card" style="text-align:center"><h3 style="margin-bottom:6px">' . ch247_e($label) . '</h3><p class="muted small">' . ch247_e($text) . '</p></div>';
}

$domainSection = '<section class="section section--soft" id="domain-search">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Domains</span><h2>Find your perfect domain</h2></div>
        <form class="domain-search" action="' . $appBase . '/app/catalog" method="get">
          <h2>Search for a domain name</h2>
          <p class="muted">Live availability checks run in the client area — prices below are the current published rates.</p>
          <div class="domain-form">
            <label class="visually-hidden" for="domain-q">Domain name</label>
            <input id="domain-q" type="search" name="q" placeholder="yourbusiness" required>
            <button class="btn btn--primary" type="submit">Search</button>
          </div>
        </form>
        ' . ($tldPills !== '' ? '<ul class="tld-row" style="list-style:none;display:flex;flex-wrap:wrap;gap:10px 22px;padding:0;margin:22px 0 0">' . $tldPills . '</ul>' : ch247_unavailable('Extension pricing')) . '
      </div>
    </section>';

$offersSection = '<section class="section" id="offers">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Pricing</span><h2>Current offers — live from our catalog</h2></div>
        ' . ($offerCards !== ''
            ? '<div class="plan-grid">' . $offerCards . '</div><p class="hint" style="margin-top:16px">These are the real plans published in the CloudHost247 catalog right now. Full comparison on the <a href="offers.php">offers page</a>.</p>'
            : ch247_unavailable('Live offers')) . '
      </div>
    </section>';

$home = '
    <section class="hero">
      <div class="container hero-inner">
        <div>
          <span class="eyebrow">CloudHost247 — Hosting · Domains · Cloud · Digital Services</span>
          <h1>Power Your Digital World With CloudHost247</h1>
          <p>Professional hosting and digital infrastructure for businesses, developers and growing teams — fast, secure and built to scale with you.</p>
          <div class="hero-ctas">
            <a class="btn btn--primary btn--lg" href="' . $appBase . '/app/catalog">Get Started</a>
            <a class="btn btn--secondary btn--lg" href="domain.php">Find a Domain</a>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="grid grid--3">' . $trustHtml . '</div>
      </div>
    </section>

    ' . $domainSection . '

    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Services</span><h2>Everything you need to launch and grow</h2></div>
        <div class="grid grid--3">' . $serviceCards . '</div>
      </div>
    </section>

    ' . $offersSection . '

    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Why CloudHost247</span><h2>Hosting you can hold us to</h2></div>
        <div class="grid grid--3">
          <div class="card"><h3>Transparent pricing</h3><p>Every price on this website is served live from our catalog. No bait rates, no invented discounts.</p></div>
          <div class="card"><h3>One professional platform</h3><p>Hosting, domains, billing and support in a single client area — with passkey sign-in and two-factor security.</p></div>
          <div class="card"><h3>Honest operations</h3><p>Our status page shows only what monitoring actually confirms, and our policies are written to be read.</p></div>
        </div>
      </div>
    </section>
' . ch247_cta_band('Ready to build something serious?', 'Choose a plan, check out securely and manage everything from one professional client area.', 'Get Started', $appBase . '/app/catalog');

echo ch247_page([
    'title' => 'CloudHost247 — Professional Cloud Hosting & Digital Infrastructure',
    'description' => 'Fast, secure and scalable hosting infrastructure: web hosting, VPS, dedicated servers, domains, business email and security — built for businesses and developers worldwide.',
    'canonical' => 'index.php',
    'active' => 'home',
    'crumbs' => [],
    'jsonld' => [
        '@context' => 'https://schema.org',
        '@type' => 'Organization',
        'name' => CH247_BRAND,
        'url' => ch247_origin() . '/',
        'description' => 'Professional cloud hosting and digital infrastructure.',
    ],
], $home);
