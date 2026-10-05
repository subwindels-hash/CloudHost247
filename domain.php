<?php
/**
 * CloudHost247 — Domains. Extension pricing is live from the platform;
 * availability searches run in the client area against the real registry APIs.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$appBase = ch247_e(CH247_APP_BASE);

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Domains']],
    'Domains',
    'Search, register, transfer and renew domains — with transparent, live pricing for every extension we offer.'
) . '
    <section class="section" id="search">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Search</span><h2>Find your domain</h2></div>
        <form class="domain-search" action="' . $appBase . '/app/catalog" method="get">
          <h2>Search for a domain name</h2>
          <p class="muted">Availability is checked live against the registry when you continue in the client area.</p>
          <div class="domain-form">
            <label class="visually-hidden" for="domain-q">Domain name</label>
            <input id="domain-q" type="search" name="q" placeholder="yourbusiness" required>
            <button class="btn btn--primary" type="submit">Search</button>
          </div>
        </form>
      </div>
    </section>

    <section class="section section--soft" id="pricing">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Pricing</span><h2>Extension pricing — live from our platform</h2></div>
        ' . ch247_extension_table() . '
      </div>
    </section>

    <section class="section" id="transfer">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Manage</span><h2>Register, transfer, renew</h2></div>
        <div class="grid grid--3">
          <div class="card"><h3>Register</h3><p>Pick your extension, complete checkout and the registration is submitted to the registry. WHOIS privacy and DNS management are included where the registry allows.</p></div>
          <div class="card"><h3>Transfer</h3><p>Bring existing domains to CloudHost247. Unlock the domain at your current registrar, obtain the authorization code, and start the transfer from your client area. Transfer pricing is shown before you pay.</p></div>
          <div class="card"><h3>Renew</h3><p>Renewal pricing is published above for every extension. Enable auto-renew in your client area so a missed email never costs you a domain — the full lifecycle is documented in our <a href="domain-renewal-policy.php">Renewal &amp; Deletion Policy</a>.</p></div>
        </div>
        <p class="hint" style="margin-top:18px">Domain registrations are governed by our <a href="domain-agreement.php">Domain Registration Agreement</a> and the policies of the relevant registry. Need a domain someone else holds? Read about our <a href="domain-brokerage-terms.php">brokerage service terms</a>.</p>
      </div>
    </section>
' . ch247_cta_band('Ready to register?', 'Search your name, see the real price, and complete checkout in minutes.', 'Search Domains', '#search');

echo ch247_page([
    'title' => 'Domain Names — Search, Register, Transfer | CloudHost247',
    'description' => 'Register, transfer and renew domains with CloudHost247. Live extension pricing, WHOIS privacy and DNS management included.',
    'canonical' => 'domain.php',
    'active' => 'domains',
    'crumbs' => [['index.php', 'Home'], [null, 'Domains']],
], $content);
