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

$legalSections = [
    [
        'id'     => 'terms-of-service',
        'title'  => 'Terms of Service',
        'desc'   => 'The terms and conditions that govern your use of our platform, services, and products. Please read these carefully before using any of our services.',
        'link'   => 'terms-of-service.php',
        'icon'   => 'fa-file-contract',
    ],
    [
        'id'     => 'privacy-policy',
        'title'  => 'Privacy Policy',
        'desc'   => 'Learn how we collect, store, protect, and process your personal data. This policy explains your privacy rights and our commitment to data protection.',
        'link'   => 'privacy-policy.php',
        'icon'   => 'fa-user-shield',
    ],
    [
        'id'     => 'acceptable-use',
        'title'  => 'Acceptable Use Policy',
        'desc'   => 'Rules and guidelines for using our platform fairly and lawfully. This policy ensures a secure, reliable environment for all users.',
        'link'   => 'acceptable-use-policy.php',
        'icon'   => 'fa-check-double',
    ],
    [
        'id'     => 'refund-policy',
        'title'  => 'Refund Policy',
        'desc'   => 'Clear conditions under which refunds may be issued, including eligibility criteria, timeframes, and exceptions for digital services.',
        'link'   => 'refund-policy.php',
        'icon'   => 'fa-undo-alt',
    ],
    [
        'id'     => 'cookie-policy',
        'title'  => 'Cookie Policy',
        'desc'   => 'Information about how we use cookies and tracking technologies to improve your browsing experience and platform functionality.',
        'link'   => 'cookie-policy.php',
        'icon'   => 'fa-cookie-bite',
    ],
    [
        'id'     => 'disclaimer',
        'title'  => 'Disclaimer',
        'desc'   => 'Important limitations of liability and legal disclaimers regarding the use of our platform, services, and published content.',
        'link'   => 'disclaimer.php',
        'icon'   => 'fa-exclamation-triangle',
    ],
    [
        'id'     => 'domain-agreement',
        'title'  => 'Domain Registration Agreement',
        'desc'   => 'Terms governing domain name registration, transfers, renewals, and ownership rights. Includes registrar obligations and registrant responsibilities.',
        'link'   => 'domain-registration-agreement.php',
        'icon'   => 'fa-globe',
    ],
    [
        'id'     => 'backup-policy',
        'title'  => 'Backup Policy',
        'desc'   => 'Our backup procedures, retention schedules, and recommendations for protecting your data. Understand what we back up and your responsibilities.',
        'link'   => 'backup-policy.php',
        'icon'   => 'fa-hdd',
    ],
    [
        'id'     => 'fair-usage',
        'title'  => 'Fair Usage Policy',
        'desc'   => 'Resource usage limits and fair allocation rules to ensure optimal performance and stability for all customers on shared infrastructure.',
        'link'   => 'fair-usage-policy.php',
        'icon'   => 'fa-balance-scale',
    ],
    [
        'id'     => 'cybercrime',
        'title'  => 'Cybercrime Detection Policy',
        'desc'   => 'How we detect, prevent, and respond to suspicious activity, abuse reports, and illegal use of our network and services.',
        'link'   => 'cybercrime-detection-policy.php',
        'icon'   => 'fa-shield-alt',
    ],
];

$cards = '';
foreach ($legalSections as $section) {
    $link = (string) ($section['link'] ?? '');
    if ($link === '' || $link === '#') {
        continue;
    }
    $cards .= '<div class="card"><h3>' . ch247_e($section['title'] ?? '') . '</h3>'
        . '<p>' . ch247_e($section['desc'] ?? '') . '</p>'
        . '<a class="btn btn--secondary" href="' . ch247_e($link) . '">Read the document</a></div>';
}

echo ch247_page([
    'title' => 'Legal & Policy Center | CloudHost247',
    'description' => 'All CloudHost247 legal documents in one place: terms, privacy, cookies, acceptable use, refunds, domain policies and more.',
    'canonical' => 'legal.php',
    'active' => 'company',
    'crumbs' => [['index.php', 'Home'], [null, 'Legal & Policy Center']],
], ch247_page_head([['index.php', 'Home'], [null, 'Legal & Policy Center']], 'Legal & Policy Center', 'Every policy that governs our services, written to be read — plain language, current versions, all in one place.')
    . '<section class="section"><div class="container"><div class="grid grid--3">' . $cards . '</div>'
    . '<p class="hint" style="margin-top:22px">Documents that are not yet published here are maintained as versioned pages on the platform at /legal. Nothing on this page is legal advice; it describes our actual policies.</p>'
    . '</div></section>');
