<?php
/**
 * CloudHost247 — Developer Friendly. Factual platform capabilities only.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Developer Friendly']],
    'Built for Developers',
    'Real resources, real access, real control — a platform that gets out of your way while you build.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Platform</span><h2>Tools that respect your workflow</h2></div>
        <div class="grid grid--3">
          <div class="card"><h3>Root access on VPS</h3><p>Every VPS plan gives you full root: install the runtime, database and services your stack needs — nothing locked down.</p></div>
          <div class="card"><h3>Modern runtimes</h3><p>Current PHP runtimes on shared hosting, and your choice of distribution on virtual and dedicated servers.</p></div>
          <div class="card"><h3>Database access</h3><p>MySQL/MariaDB databases with direct connection details and web administration tools.</p></div>
          <div class="card"><h3>DNS API-ready records</h3><p>Full DNS zone control for the domains you manage, with the records your integrations require.</p></div>
          <div class="card"><h3>Secure account APIs</h3><p>Our client platform is built API-first: catalog, billing, domains and support behind documented internal endpoints.</p></div>
          <div class="card"><h3>Snapshots & backups</h3><p>Snapshot before risky changes; restore from your client area when things go sideways.</p></div>
        </div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Documentation</span><h2>Learn the platform</h2></div>
        <p class="muted" style="max-width:760px">Our knowledgebase documents how the platform actually works — sign-in security, billing, domains and more — and grows as we publish. No filler articles, ever.</p>
        <div class="mt-2">' . ch247_article_cards(ch247_articles('kb'), 'kb') . '</div>
      </div>
    </section>
' . ch247_cta_band('Build on CloudHost247', 'Start with a VPS and shape it to your stack — transparent pricing, instant checkout.', 'View VPS Plans', 'vps-hosting.php');

echo ch247_page([
    'title' => 'Developer Friendly Hosting | CloudHost247',
    'description' => 'Root access, modern runtimes, database and DNS control, snapshots and an API-first client platform — CloudHost247 for developers.',
    'canonical' => 'developer-friendly.php',
    'active' => 'resources',
    'crumbs' => [['index.php', 'Home'], [null, 'Developer Friendly']],
], $content);
