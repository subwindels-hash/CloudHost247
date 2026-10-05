<?php
/**
 * CloudHost247 — Public Cloud (VPS line). Plans and pricing are live from the catalog.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Public Cloud']],
    'Public Cloud',
    'On-demand virtual capacity for public-facing applications — provisioned fast, priced transparently.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Elastic capacity, published pricing</h2></div>
        <p class="muted" style="max-width:760px">Run public-facing websites, APIs and services on virtual servers that are provisioned as soon as payment settles. Every configuration below comes with live catalog pricing — no sales call required to know what it costs.</p>
        <div class="mt-2">' . ch247_plan_cards('vps') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Why public cloud here</span><h2>Built for production traffic</h2></div>
        ' . ch247_feature_grid([
            ['Fast provisioning', 'Servers enter provisioning immediately after checkout.'],
            ['Transparent pricing', 'Live catalog prices — monthly or annual, your choice.'],
            ['Root access', 'Deploy any stack your application requires.'],
            ['Snapshot support', 'Snapshot before big changes; roll back in minutes.'],
            ['Vertical scaling', 'Move to a larger configuration without starting over.'],
            ['Real support', 'Engineers on tickets when something needs attention.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Deploy to the public cloud', 'Pick a configuration and go live — checkout takes minutes.', 'Choose a Configuration', CH247_APP_BASE . '/app/catalog?product=vps');

echo ch247_page([
    'title' => 'Public Cloud — On-Demand Virtual Capacity | CloudHost247',
    'description' => 'Public cloud virtual servers with fast provisioning and transparent live pricing on the CloudHost247 platform.',
    'canonical' => 'vps-publiccloud.php',
    'active' => 'servers',
    'crumbs' => [['index.php', 'Home'], [null, 'Public Cloud']],
], $content);
