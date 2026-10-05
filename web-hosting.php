<?php
/**
 * CloudHost247 — Web Hosting. Plans and pricing are live from the catalog.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Web Hosting']],
    'Web Hosting',
    'Reliable hosting for personal websites, businesses and professional websites.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Hosting that stays out of your way</h2></div>
        <p class="muted" style="max-width:760px">Web Hosting on CloudHost247 is built for speed and simplicity: NVMe storage, free SSL on every plan and automated backups, with a control panel your team already knows how to use.</p>
        <div class="mt-2">' . ch247_plan_cards('web-hosting') . '</div>
        <p class="hint" style="margin-top:14px">Prices are loaded live from the CloudHost247 catalog. Renewal pricing is shown per plan where it differs.</p>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Included</span><h2>What every plan is built on</h2></div>
        ' . ch247_feature_grid([
            ['NVMe storage', 'Fast solid-state storage keeps pages and databases responsive.'],
            ['Free SSL certificates', 'Every site is encrypted by default — no extra cost.'],
            ['Automated backups', 'Scheduled backups with restore available from your client area.'],
            ['Email accounts', 'Professional mailboxes on your own domain.'],
            ['One-click installers', 'Deploy popular applications in minutes.'],
            ['Control panel', 'A familiar panel for files, databases, DNS and mail.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Start with Web Hosting', 'Configure your plan and check out securely — provisioning begins as soon as payment settles.', 'Choose a Plan', CH247_APP_BASE . '/app/catalog?product=web-hosting');

echo ch247_page([
    'title' => 'Web Hosting — Fast, Secure Shared Hosting | CloudHost247',
    'description' => 'Reliable web hosting with NVMe storage, free SSL and automated backups. Real plans and pricing, loaded live from the CloudHost247 catalog.',
    'canonical' => 'web-hosting.php',
    'active' => 'hosting',
    'crumbs' => [['index.php', 'Home'], [null, 'Web Hosting']],
], $content);
