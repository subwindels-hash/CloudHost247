<?php
/**
 * CloudHost247 — Private Cloud (VPS line). Plans and pricing are live from the catalog.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Private Cloud']],
    'Private Cloud',
    'Isolated virtual infrastructure for teams that need their own environment — dedicated resources with room to architect.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Your own corner of the platform</h2></div>
        <p class="muted" style="max-width:760px">A private cloud on CloudHost247 gives you isolated virtual resources you control end-to-end: your operating system, your network configuration, your stack. The configurations below are the live VPS line from our catalog — pick the size that matches your environment.</p>
        <div class="mt-2">' . ch247_plan_cards('vps') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Use cases</span><h2>What teams run here</h2></div>
        ' . ch247_feature_grid([
            ['Internal applications', 'Intranets, dashboards and tooling away from shared infrastructure.'],
            ['Development environments', 'Full-stack environments that mirror production.'],
            ['Database servers', 'Dedicated resources for data-heavy workloads.'],
            ['Custom stacks', 'Run the exact runtime, versions and services you need.'],
            ['Compliance boundaries', 'Isolated environments where access is yours to control.'],
            ['Growth runway', 'Scale resources as your team and traffic grow.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Design your private environment', 'Start from a published configuration and shape it to your workload.', 'Choose a Configuration', CH247_APP_BASE . '/app/catalog?product=vps');

echo ch247_page([
    'title' => 'Private Cloud — Isolated Virtual Infrastructure | CloudHost247',
    'description' => 'Private cloud environments with dedicated virtual resources on the CloudHost247 platform. Live configurations and pricing from the catalog.',
    'canonical' => 'vps-privatecloud.php',
    'active' => 'servers',
    'crumbs' => [['index.php', 'Home'], [null, 'Private Cloud']],
], $content);
