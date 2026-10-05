<?php
/**
 * CloudHost247 — SSL & Security. Factual service page; no invented certifications.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$siteInfo = ch247_site_info() ?? [];
$supportEmail = isset($siteInfo['supportEmail']) ? ch247_e($siteInfo['supportEmail']) : null;

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'SSL & Security']],
    'SSL Certificates & Security',
    'Encryption-first hosting: free SSL on hosting plans, hardened defaults and security guidance from real engineers.'
) . '
    <section class="section">
      <div class="container">
        <div class="section-head"><span class="eyebrow">SSL</span><h2>Every site encrypted by default</h2></div>
        <div class="grid grid--3">
          <div class="card"><h3>Free SSL on hosting</h3><p>Every hosting plan includes SSL certificates for your sites — issued and renewed automatically, at no extra cost.</p></div>
          <div class="card"><h3>Managed certificates</h3><p>Need a certificate for infrastructure outside our hosting? Ask our team — we will point you at the right option for your setup.</p></div>
          <div class="card"><h3>HTTPS everywhere</h3><p>Our platform serves over HTTPS and our own security practices are documented in our <a href="privacy-policy.php">Privacy Policy</a> and policies.</p></div>
        </div>
      </div>
    </section>
    <section class="section section--soft" id="security">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Security</span><h2>How the platform stays safe</h2></div>
        ' . ch247_feature_grid([
            ['Passkeys & 2FA', 'Sign in with passkeys or add two-factor authentication to your account.'],
            ['Account isolation', 'Accounts are separated so one compromised site does not become two.'],
            ['Hardened defaults', 'Security-first configuration across the stack, maintained by our team.'],
            ['Abuse monitoring', 'Our <a href="cybercrime-policy.php">Cybercrime Detection Policy</a> describes how abuse is detected and handled.', true],
            ['Backups', 'Automated backups per our published <a href="backup-policy.php">Backup Policy</a>.', true],
            ['Responsible disclosure', 'Found a security issue? ' . ($supportEmail !== null ? 'Report it to <a href="mailto:' . $supportEmail . '">' . $supportEmail . '</a>.' : 'Report it via the <a href="help-center.php">Help Center</a>.'), true],
        ]) . '
      </div>
    </section>
' . ch247_cta_band('Secure your project', 'Start with an encrypted-by-default hosting plan, or talk to us about your specific requirements.', 'View Hosting Plans', 'web-hosting.php');

echo ch247_page([
    'title' => 'SSL Certificates & Security | CloudHost247',
    'description' => 'Free SSL on every hosting plan, hardened platform defaults, passkey sign-in and documented security practices at CloudHost247.',
    'canonical' => 'ssl-certificate.php',
    'active' => 'business',
    'crumbs' => [['index.php', 'Home'], [null, 'SSL & Security']],
], $content);
