<?php
/**
 * CloudHost247 — Enterprise Servers. Positioning page; capacity scoped per deployment.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Enterprise Servers']],
    'Enterprise Servers',
    'Large-scale compute for organizations that run serious infrastructure — scoped, quoted and delivered per deployment.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Approach</span><h2>Enterprise capacity, engineered with you</h2></div>
        <p class="muted" style="max-width:760px">Enterprise deployments rarely fit a price list: multi-server environments, specific interconnects, compliance constraints and growth plans all shape the build. Rather than publish invented packages, we scope each deployment with you and quote the real configuration.</p>
        <div class="mt-2">' . ch247_plan_cards('dedicated', 'Standard dedicated configurations will appear here when published. Enterprise-scale deployments are always scoped individually — contact us to start.') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">How it works</span><h2>From requirement to running hardware</h2></div>
        ' . ch247_feature_grid([
            ['1. Requirements', 'Workload, capacity, compliance and growth — documented together.'],
            ['2. Architecture', 'A proposed topology with hardware, network and redundancy.'],
            ['3. Formal quote', 'Itemized pricing for exactly what is proposed — no hidden fees.'],
            ['4. Delivery', 'Provisioning and handover with credentials and documentation.'],
            ['5. Operation', 'Managed support tiers available for the lifetime of the deployment.'],
            ['6. Growth', 'Add capacity as demand grows, without re-architecting.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Start an enterprise conversation', 'Describe your workload and constraints — an engineer, not a sales script, will reply.', 'Contact Support', 'help-center.php');

echo ch247_page([
    'title' => 'Enterprise Servers — Large-Scale Compute | CloudHost247',
    'description' => 'Enterprise-scale server deployments on CloudHost247: scoped per project, quoted transparently, delivered with managed support options.',
    'canonical' => 'enterprise-servers.php',
    'active' => 'servers',
    'crumbs' => [['index.php', 'Home'], [null, 'Enterprise Servers']],
], $content);
