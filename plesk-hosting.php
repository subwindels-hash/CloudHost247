<?php
/**
 * CloudHost247 — Plesk Hosting. Honest positioning until plans are published.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Plesk Hosting']],
    'Plesk Hosting',
    'Web hosting managed through the Plesk control panel — sites, mail, databases and SSL in one interface.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Plesk-managed hosting</h2></div>
        <p class="muted" style="max-width:760px">Plesk gives you a clean, modern panel for managing websites, mailboxes, databases and certificates. Plesk-based plans are listed here as soon as they are published in the catalog.</p>
        <div class="mt-2">' . ch247_plan_cards('plesk', 'Plesk plans have not been published yet. Our current Web Hosting line ships with a full control panel — or ask us which panel fits your workflow best.') . '</div>
      </div>
    </section>
' . ch247_cta_band('Compare our hosting lines', 'See every published plan with live pricing in one place.', 'View Offers', 'offers.php');

echo ch247_page([
    'title' => 'Plesk Hosting — Modern Panel Hosting | CloudHost247',
    'description' => 'Web hosting managed through Plesk on the CloudHost247 platform. Plans appear here when published — no placeholder pricing.',
    'canonical' => 'plesk-hosting.php',
    'active' => 'hosting',
    'crumbs' => [['index.php', 'Home'], [null, 'Plesk Hosting']],
], $content);
