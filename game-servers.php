<?php
/**
 * CloudHost247 — Game Servers. Honest positioning on top of the VPS line.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Game Servers']],
    'Game Servers',
    'Low-latency virtual servers for community game servers — sized for the games you host.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Plans</span><h2>Run your community server</h2></div>
        <p class="muted" style="max-width:760px">Dedicated game-server packages have not been published yet. Until they are, our VPS line is the right foundation: dedicated CPU and RAM, full root access to install your game server software, and enough network capacity for a busy community. Pick a configuration below — or ask us what your game needs.</p>
        <div class="mt-2">' . ch247_plan_cards('vps') . '</div>
      </div>
    </section>
    <section class="section section--soft">
      <div class="container">
        <div class="section-head"><span class="eyebrow">What you control</span><h2>Your server, your rules</h2></div>
        ' . ch247_feature_grid([
            ['Full root access', 'Install and configure any game server binary.'],
            ['Dedicated CPU & RAM', 'No noisy neighbours stealing your tick rate.'],
            ['Mod freedom', 'Run the mods, plugins and maps your community uses.'],
            ['Backups & snapshots', 'Protect worlds, saves and configuration.'],
            ['Player slots your call', 'Slots are limited by your hardware, not by a paywall.'],
            ['Upgrade any time', 'More players? Move to a bigger configuration.'],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Spin up a game server', 'Choose a VPS configuration, install your game and invite your community.', 'Choose a Configuration', CH247_APP_BASE . '/app/catalog?product=vps');

echo ch247_page([
    'title' => 'Game Servers — Low-Latency Hosting | CloudHost247',
    'description' => 'Game server hosting on CloudHost247: dedicated resources, full root access and snapshots, built on our transparent VPS line.',
    'canonical' => 'game-servers.php',
    'active' => 'servers',
    'crumbs' => [['index.php', 'Home'], [null, 'Game Servers']],
], $content);
