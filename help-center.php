<?php
/**
 * CloudHost247 — Help Center. Support hub: KB articles from the content API,
 * contact channels from operator-configured site info, ticket entry point.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$siteInfo = ch247_site_info() ?? [];
$appBase = ch247_e(CH247_APP_BASE);

$contactCards = '';
$contactEntries = [
    ['supportEmail', 'Support', 'For technical issues with your services.'],
    ['salesEmail', 'Sales', 'For quotes, upgrades and new deployments.'],
    ['billingEmail', 'Billing', 'For invoices, payments and refunds.'],
    ['phone', 'Phone', 'Call us during working hours.'],
];
foreach ($contactEntries as [$key, $label, $text]) {
    if (empty($siteInfo[$key])) {
        continue;
    }
    $value = (string) $siteInfo[$key];
    $action = str_contains($key, 'Email')
        ? '<a class="btn btn--secondary" href="mailto:' . ch247_e($value) . '">' . ch247_e($value) . '</a>'
        : '<a class="btn btn--secondary" href="tel:' . ch247_e(preg_replace('/[^0-9+]/', '', $value)) . '">' . ch247_e($value) . '</a>';
    $contactCards .= '<div class="card"><h3>' . ch247_e($label) . '</h3><p>' . ch247_e($text) . '</p>' . $action . '</div>';
}
if ($contactCards === '') {
    $contactCards = '<div class="card"><h3>Contact channels being published</h3><p>Our official contact details appear here as soon as they are configured. Until then, open a ticket from the client area and a member of the team will answer.</p></div>';
}

$query = isset($_GET['q']) ? trim((string) $_GET['q']) : '';
$kbArticles = ch247_article_cards(ch247_articles('kb', $query), 'kb');
$kbHeading = $query !== ''
    ? 'Knowledgebase results for &ldquo;' . ch247_e($query) . '&rdquo;'
    : 'From the knowledgebase';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Help Center']],
    'Help Center',
    'Find answers in the knowledgebase, check common questions, or talk to a human — whichever gets you moving fastest.'
) . '
    <section class="section">
      <div class="container">
        <form class="domain-search" method="get" action="help-center.php">
          <h2>How can we help?</h2>
          <p class="muted">Search guides across hosting, domains, billing and account security.</p>
          <div class="domain-form">
            <label class="visually-hidden" for="help-q">Search help</label>
            <input id="help-q" type="search" name="q" value="' . ch247_e($query) . '" placeholder="e.g. passkey, invoice, domain search">
            <button class="btn btn--primary" type="submit">Search</button>
          </div>
        </form>
        <div class="grid grid--3 mt-2">
          <div class="card"><h3>Open a ticket</h3><p>Tickets go straight to our support queue and are answered by engineers — not bots.</p><a class="btn btn--primary" href="' . $appBase . '/app/support">Open a Ticket</a></div>
          <div class="card"><h3>Knowledgebase</h3><p>Guides written by our team documenting how the platform actually works.</p><a class="btn btn--secondary" href="developer-friendly.php#documentation">Browse Guides</a></div>
          <div class="card"><h3>FAQs</h3><p>Straight answers to the questions we hear most often.</p><a class="btn btn--secondary" href="faqs.php">Read FAQs</a></div>
        </div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Latest guides</span><h2>' . $kbHeading . '</h2></div>
        ' . $kbArticles . '
      </div>
    </section>
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Contact</span><h2>Talk to us directly</h2></div>
        <div class="grid grid--3">' . $contactCards . '</div>
      </div>
    </section>';

echo ch247_page([
    'title' => 'Help Center — Support, Guides & Contact | CloudHost247',
    'description' => 'CloudHost247 support hub: knowledgebase guides, frequently asked questions, ticket support and official contact channels.',
    'canonical' => 'help-center.php',
    'active' => 'resources',
    'crumbs' => [['index.php', 'Home'], [null, 'Help Center']],
], $content);
