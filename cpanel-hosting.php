<?php
/**
 * CloudHost247 — cPanel Hosting. Runs on the web-hosting catalog line;
 * the control panel included with each plan is shown in the catalog itself.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'cPanel Hosting']],
    'cPanel Hosting',
    'Classic cPanel-powered web hosting: files, databases, email and DNS in the panel your team already knows.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>A familiar panel, on modern infrastructure</h2></div>
        <p class="muted" style="max-width:760px">Our web hosting line is managed through a full control panel — file manager, databases, mail accounts, DNS zones and SSL. Plans below are loaded live from the catalog; the exact panel each plan ships with is listed on its specification sheet.</p>
        <div class="mt-2">' . ch247_plan_cards('web-hosting') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Panel features</span><h2>Everything managed in one place</h2></div>
        ' . ch247_feature_grid([
            ['File management', 'Upload, edit and organize site files directly in the panel.'],
            ['Databases', 'Create and manage MySQL/MariaDB databases with web tools.'],
            ['Email accounts', 'Mailboxes, forwarders and autoresponders on your domain.'],
            ['DNS zones', 'Full DNS editing for records and subdomains.'],
            ['SSL management', 'Issue and renew certificates without leaving the panel.'],
            ['Backups', 'Download backups and trigger restores on demand.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Get started with panel hosting', 'Choose a plan and get your control panel credentials the moment provisioning completes.', 'Choose a Plan', CH247_APP_BASE . '/app/catalog?product=web-hosting');

echo ch247_page([
    'title' => 'cPanel Hosting — Control Panel Web Hosting | CloudHost247',
    'description' => 'Web hosting with a full control panel for files, databases, email and DNS — plans and pricing loaded live from the CloudHost247 catalog.',
    'canonical' => 'cpanel-hosting.php',
    'active' => 'hosting',
    'crumbs' => [['index.php', 'Home'], [null, 'cPanel Hosting']],
], $content);
