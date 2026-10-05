<?php
/**
 * CloudHost247 — VPS Hosting. Plans and pricing are live from the catalog.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'VPS Hosting']],
    'VPS Hosting',
    'Dedicated virtual resources with full root access — sized for workloads that have outgrown shared hosting.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Virtual servers, sized honestly</h2></div>
        <p class="muted" style="max-width:760px">Each VPS plan publishes exactly what you get — vCPU, RAM, storage and bandwidth — with live pricing straight from the catalog. If you need a configuration that is not listed, our team will scope it with you.</p>
        <div class="mt-2">' . ch247_plan_cards('vps') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Capabilities</span><h2>What a CloudHost247 VPS gives you</h2></div>
        ' . ch247_feature_grid([
            ['Dedicated resources', 'Your vCPU and RAM are allocated to you, not oversold into noise.'],
            ['Full root access', 'Install, configure and tune the system your application needs.'],
            ['SSD-class storage', 'Fast block storage for databases and busy applications.'],
            ['Snapshot-ready', 'Point-in-time snapshots for safe changes and rollbacks.'],
            ['Your OS, your stack', 'Run the distribution and software your workload requires.'],
            ['Upgrade path', 'Move to a larger plan as traffic and data grow.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Provision a VPS', 'Choose a configuration, check out securely and your server enters provisioning immediately.', 'Choose a Plan', CH247_APP_BASE . '/app/catalog?product=vps');

echo ch247_page([
    'title' => 'VPS Hosting — Dedicated Virtual Resources | CloudHost247',
    'description' => 'VPS hosting with dedicated vCPU, RAM and fast storage, full root access and live-configured plans loaded from the CloudHost247 catalog.',
    'canonical' => 'vps-hosting.php',
    'active' => 'servers',
    'crumbs' => [['index.php', 'Home'], [null, 'VPS Hosting']],
], $content);
