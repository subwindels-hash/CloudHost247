<?php
/**
 * CloudHost247 — Business Email. Plans and pricing are live from the catalog.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Business Email']],
    'Business Email',
    'Professional mailboxes on your own domain — webmail, mobile access and anti-spam protection.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Email that looks like your business</h2></div>
        <p class="muted" style="max-width:760px">Your name, your domain, your email. Business email plans appear below as soon as they are published in the catalog — and many of our web hosting plans already include email accounts, so check what you get with hosting first.</p>
        <div class="mt-2">' . ch247_plan_cards('business-email', 'Standalone business email plans have not been published yet. Email accounts are included with our Web Hosting plans — or contact us and we will set up mailboxes for your domain.') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Included</span><h2>Professional mail, properly run</h2></div>
        ' . ch247_feature_grid([
            ['Your domain', 'Mailboxes at you@yourcompany — the professional standard.'],
            ['Webmail & clients', 'Work from the browser or connect Outlook, Thunderbird and mobile.'],
            ['Spam & virus filtering', 'Filtering on inbound mail to keep inboxes clean.'],
            ['Forwarders & aliases', 'Route mail to the right person or team.'],
            ['DNS handled', 'SPF/DKIM records configured for deliverability.'],
            ['Restore options', 'Recover deleted messages where backups cover them.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Get your business mailbox', 'Choose a plan or add mailboxes alongside your hosting — all managed from one client area.', 'Choose a Plan', CH247_APP_BASE . '/app/catalog?product=business-email');

echo ch247_page([
    'title' => 'Business Email — Professional Mailboxes | CloudHost247',
    'description' => 'Business email on your own domain with webmail, mobile access and spam filtering. Plans load live from the CloudHost247 catalog.',
    'canonical' => 'email-hosting.php',
    'active' => 'business',
    'crumbs' => [['index.php', 'Home'], [null, 'Business Email']],
], $content);
