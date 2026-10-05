<?php
/**
 * CloudHost247 — Acceptable Use Policy. Mirrors the versioned policy
 * maintained on the platform (legal/acceptable-use).
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$doc = [
    'hero' => [
        'title' => 'Acceptable Use Policy',
        'subtitle' => 'Version 1.0 · Effective 2026-10-05',
    ],
    'introduction' => [
        'content' => 'This Acceptable Use Policy (AUP) defines how CloudHost247 services may be used. It protects the platform, our customers and the wider internet. By using any CloudHost247 service you agree to this policy; the versioned copy maintained on the platform is authoritative.',
    ],
    'sections' => [
        [
            'id' => 'prohibited-use',
            'title' => '1. Prohibited use',
            'content' => 'The following uses of CloudHost247 services are prohibited:',
            'items' => [
                'Illegal content or activity, including content that infringes intellectual property rights.',
                'Malware distribution, phishing, botnet command-and-control or scanning of networks you do not own.',
                'Spam, unsolicited bulk messaging or abusive automated traffic.',
                'Attempts to compromise the platform, other customers, or circumvent service limits.',
            ],
        ],
        [
            'id' => 'resource-use',
            'title' => '2. Resource use',
            'content' => 'Services must be used within their published limits. Sustained abuse of shared resources may lead to throttling, suspension or migration to an appropriate service.',
        ],
        [
            'id' => 'enforcement',
            'title' => '3. Enforcement',
            'content' => 'Violations are handled proportionally: notice and remediation first, suspension where conduct continues or is severe. Illegal content is escalated to the relevant authorities where required.',
        ],
    ],
];

echo ch247_page([
    'title' => 'Acceptable Use Policy | CloudHost247',
    'description' => 'The CloudHost247 Acceptable Use Policy: prohibited uses, resource limits and how enforcement is applied.',
    'canonical' => 'acceptable-use-policy.php',
    'active' => 'company',
    'crumbs' => [['index.php', 'Home'], ['legal.php', 'Legal'], [null, 'Acceptable Use Policy']],
], ch247_page_head([['index.php', 'Home'], ['legal.php', 'Legal'], [null, 'Acceptable Use Policy']], 'Acceptable Use Policy', 'The rules that keep the platform safe and reliable for everyone.')
    . '<section class="section"><div class="container"><div class="card" style="padding:28px">' . ch247_policy_doc($doc) . '</div></div></section>');
