<?php
/**
 * CloudHost247 — About. No invented history, headcounts or statistics:
 * this page describes what the company does and how it operates.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$siteInfo = ch247_site_info() ?? [];

$contactBlock = '';
$contactBits = [];
foreach (['supportEmail' => 'Support', 'salesEmail' => 'Sales', 'phone' => 'Phone'] as $key => $label) {
    if (!empty($siteInfo[$key])) {
        $value = ch247_e($siteInfo[$key]);
        $contactBits[] = '<li><strong>' . $label . ':</strong> ' . (str_contains($key, 'Email') ? '<a href="mailto:' . $value . '">' . $value . '</a>' : $value) . '</li>';
    }
}
if ($contactBits) {
    $contactBlock = '<div class="card"><h3>Reach us</h3><ul style="display:grid;gap:8px">' . implode('', $contactBits) . '</ul></div>';
}

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'About']],
    'About CloudHost247',
    'A professional hosting and digital infrastructure company — what we do, how we work, and what you can hold us to.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Who we are</span><h2>Infrastructure, treated seriously</h2></div>
        <div class="legal-prose card" style="padding:28px">
          <p>CloudHost247 provides professional web hosting, cloud infrastructure, domain services and digital solutions for individuals, businesses and organizations worldwide.</p>
          <p>We built this company around a simple idea: hosting should behave the way it is advertised. Prices that are real. Status that reflects reality. Policies written to be read. Support answered by people who understand the platform.</p>
          <p>Everything you see on this website — plans, prices, extensions, articles — is served live from our own platform. When something has not been configured yet, we say so instead of inventing it. That discipline extends to how we operate: honest status reporting, documented backup and refund policies, and security practices we publish rather than hand-wave.</p>
        </div>
      </div>
    </section>
    <section class="section section--soft" id="why">
      <div class="container">
        <div class="section-head"><span class="eyebrow">What we commit to</span><h2>The CloudHost247 standard</h2></div>
        ' . ch247_feature_grid([
            ['Real pricing', 'Every price is served from our catalog — no bait rates, no invented discounts.'],
            ['Honest status', 'We report only what monitoring actually confirms; unmonitored systems are labeled as such.'],
            ['Documented policies', 'Backups, refunds, acceptable use and data protection — published and versioned.'],
            ['Security by default', 'Passkeys, two-factor authentication and encryption-first defaults on the platform.'],
            ['Professional support', 'Tickets answered by engineers who run the platform, not scripts.'],
            ['Built to grow', 'From one website to full infrastructure on a single platform and account.'],
        ]) . '
      </div>
    </section>
    <section class="section">
      <div class="container">
        <div class="grid grid--2">
          <div class="card"><h3>Our services</h3><p>Web hosting, WordPress hosting, VPS and dedicated servers, business email, domain registration and security — all managed from one professional client area. See <a href="offers.php">current offers</a> for what is available today.</p></div>
          ' . ($contactBlock !== '' ? $contactBlock : '<div class="card"><h3>Reach us</h3><p>Official contact channels are published on the <a href="help-center.php">Help Center</a> as soon as they are configured.</p></div>') . '
        </div>
      </div>
    </section>
' . ch247_cta_band('Work with CloudHost247', 'Choose a plan or start a conversation — either way, you get straight answers.', 'Get Started', CH247_APP_BASE . '/app/catalog');

echo ch247_page([
    'title' => 'About Us — Professional Hosting & Infrastructure | CloudHost247',
    'description' => 'CloudHost247 is a professional hosting and digital infrastructure company: real pricing, honest status, documented policies and engineering-led support.',
    'canonical' => 'aboutus.php',
    'active' => 'company',
    'crumbs' => [['index.php', 'Home'], [null, 'About']],
], $content);
