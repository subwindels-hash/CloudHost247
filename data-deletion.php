<?php
/**
 * CloudHost247 — professional standalone page.
 *
 * Shares the platform design system and shows only content that actually
 * exists: either authored policy text preserved from the previous site, or
 * live data pulled from the CloudHost247 platform API.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$prose = '<h2>Data deletion requests</h2>'
    . '<p>When you ask us to delete your personal data, we act on it. This page explains what deletion covers, what we are legally required to keep, and how to make a request.</p>'
    . '<h2>How to request deletion</h2>'
    . '<p>Open a support ticket from your client area, or email our privacy contact (listed on the <a href="help-center.php">Help Center</a>) from the address registered on your account. To protect you, we verify account ownership before acting on any deletion request.</p>'
    . '<h2>What we delete</h2>'
    . '<ul>'
    . '<li>Your profile details, contact information and account preferences.</li>'
    . '<li>Website files, databases and email data belonging to closed services, once the service itself is terminated.</li>'
    . '<li>Marketing preferences — you will receive no further communications.</li>'
    . '</ul>'
    . '<h2>What we must retain</h2>'
    . '<ul>'
    . '<li>Invoicing and payment records for the period required by applicable tax and accounting law.</li>'
    . '<li>Domain registration records for periods mandated by the registry or ICANN policy.</li>'
    . '<li>Abuse, fraud and security logs where a legal obligation or an active investigation applies.</li>'
    . '</ul>'
    . '<p>Retention is never open-ended: records kept for legal reasons are deleted as soon as the obligation expires. For the full framework, see our <a href="privacy-policy.php">Privacy Policy</a> and <a href="data-privacy-notice-and-consent-form.php">Data Privacy Notice</a>.</p>';

echo ch247_page([
    'title' => 'Data Deletion | CloudHost247',
    'description' => 'How to request deletion of your personal data from CloudHost247, what we delete, and what we are legally required to retain.',
    'canonical' => 'data-deletion.php',
    'active' => 'company',
    'crumbs' => [['index.php', 'Home'], ['legal.php', 'Legal'], [null, 'Data Deletion']],
], ch247_page_head([['index.php', 'Home'], ['legal.php', 'Legal'], [null, 'Data Deletion']], 'Data Deletion', 'Your data is yours. Here is exactly how deletion works.')
    . '<section class="section"><div class="container"><div class="card" style="padding:28px">' . ch247_prose($prose) . '</div></div></section>');
