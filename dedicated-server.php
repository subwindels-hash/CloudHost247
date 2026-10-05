<?php
/**
 * CloudHost247 — Dedicated Servers. Plans and pricing are live from the catalog.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Dedicated Servers']],
    'Dedicated Servers',
    'Single-tenant physical hardware for workloads that need every cycle, every core and complete control.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Physical machines, no neighbours</h2></div>
        <p class="muted" style="max-width:760px">Dedicated servers give you the entire machine: CPU, memory, storage and network — nothing shared, nothing noisy. Configurations and pricing are published below as soon as they are added to the catalog; custom builds are scoped with you directly.</p>
        <div class="mt-2">' . ch247_plan_cards('dedicated', 'Dedicated server configurations have not been published yet. Dedicated hardware is configured per deployment — contact us with your requirements (CPU, RAM, storage, bandwidth) and we will prepare a formal quote.') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">When dedicated is right</span><h2>Built for demanding workloads</h2></div>
        ' . ch247_feature_grid([
            ['Maximum performance', 'Every core and every byte of memory belongs to you.'],
            ['Complete control', 'Choose the OS, kernel tuning and hardware layout.'],
            ['Data-heavy applications', 'Large databases and high-throughput services at home.'],
            ['Predictable capacity', 'No multi-tenant variability — consistent performance.'],
            ['Compliance posture', 'Single-tenancy simplifies strict compliance requirements.'],
            ['Managed options', 'Managed support tiers available where you need them.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Scope a dedicated server', 'Send us your requirements and an engineer will respond with a configuration and quote.', 'Contact Support', 'help-center.php');

echo ch247_page([
    'title' => 'Dedicated Servers — Single-Tenant Hardware | CloudHost247',
    'description' => 'Dedicated physical servers for demanding workloads. Published configurations appear with live pricing; custom builds are quoted on request.',
    'canonical' => 'dedicated-server.php',
    'active' => 'servers',
    'crumbs' => [['index.php', 'Home'], [null, 'Dedicated Servers']],
], $content);
