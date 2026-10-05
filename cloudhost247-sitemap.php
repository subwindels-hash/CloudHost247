<?php
/**
 * XML sitemap for the PHP front of the CloudHost247 website.
 *
 * Lists every standalone PHP page plus, when the platform API is reachable,
 * the published knowledgebase and blog articles. Drafts are never listed —
 * the API only returns published content.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/config.php';
require_once __DIR__ . '/php/api.php';
require_once __DIR__ . '/php/layout.php';

header('Content-Type: application/xml; charset=UTF-8');
header('Cache-Control: public, max-age=900');

$origin = ch247_origin();

$pages = [
    '', 'web-hosting.php', 'wordpress-hosting.php', 'cpanel-hosting.php', 'windows-hosting.php',
    'plesk-hosting.php', 'vps-hosting.php', 'vps-privatecloud.php', 'vps-publiccloud.php',
    'dedicated-server.php', 'enterprise-servers.php', 'game-servers.php', 'email-hosting.php',
    'ssl-certificate.php', 'website-design.php', 'developer-friendly.php', 'domain.php',
    'offers.php', 'blog.php', 'help-center.php', 'faqs.php', 'aboutus.php', 'legal.php',
    'terms-of-service.php', 'privacy-policy.php', 'cookie-policy.php', 'acceptable-use-policy.php',
    'refund-policy.php', 'refund-and-cancellation-policy.php', 'fair-usage-policy.php',
    'trademark-policy.php', 'legal-notice.php', 'backup-policy.php', 'cybercrime-policy.php',
    'domain-agreement.php', 'domain-renewal-policy.php', 'domain-brokerage-terms.php',
    'domainregistrationaddendum.php', 'data-deletion.php', 'data-privacy-notice-and-consent-form.php',
    'data-protection-standards.php',
];

$xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
    . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

foreach ($pages as $page) {
    $xml .= '  <url><loc>' . htmlspecialchars($origin . '/' . $page, ENT_XML1, 'UTF-8') . "</loc></url>\n";
}

foreach (['kb' => 'kb', 'blog' => 'blog'] as $kind => $prefix) {
    $articles = ch247_articles($kind);
    if ($articles === null) {
        continue; // Platform unreachable — omit rather than guess.
    }
    foreach ($articles as $article) {
        $slug = (string) ($article['slug'] ?? '');
        if ($slug === '') {
            continue;
        }
        $xml .= '  <url><loc>' . htmlspecialchars($origin . '/' . $prefix . '/' . rawurlencode($slug), ENT_XML1, 'UTF-8') . "</loc></url>\n";
    }
}

$xml .= "</urlset>\n";
echo $xml;
