<?php
/**
 * CloudHost247 — Windows Hosting. Honest positioning until plans are published.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Windows Hosting']],
    'Windows Hosting',
    'Hosting for ASP.NET and Windows-based applications, on the same professional platform.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Windows workloads</h2></div>
        <p class="muted" style="max-width:760px">If your application is built on ASP.NET or other Windows technologies, this is the line for it. Windows plans are published here the moment they are configured in our catalog — we would rather show you nothing than placeholder pricing.</p>
        <div class="mt-2">' . ch247_plan_cards('windows', 'Windows hosting plans have not been published yet. In the meantime, our Linux-based Web Hosting and VPS lines cover most workloads — or open a ticket and we will scope your requirements.') . '</div>
      </div>
    </section>
' . ch247_cta_band('Talk to us about your stack', 'Tell us what your application needs and we will recommend the right environment — honestly.', 'Contact Support', 'help-center.php');

echo ch247_page([
    'title' => 'Windows Hosting — ASP.NET Ready | CloudHost247',
    'description' => 'Windows hosting for ASP.NET and Windows-based applications on the CloudHost247 platform. Plans appear here when published.',
    'canonical' => 'windows-hosting.php',
    'active' => 'hosting',
    'crumbs' => [['index.php', 'Home'], [null, 'Windows Hosting']],
], $content);
