<?php
/**
 * CloudHost247 — Data Protection Standards. Describes the actual controls
 * applied to customer data; no invented certifications or audit claims.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$doc = [
    'hero' => [
        'title' => 'Data Protection Standards',
        'subtitle' => 'How customer data is protected on the CloudHost247 platform',
    ],
    'introduction' => [
        'content' => 'This document describes the technical and organizational measures CloudHost247 applies to protect customer data. We publish what we actually do; where a certification or external audit does not yet exist, we do not claim one. Detailed processing terms are in our Privacy Policy and Data Privacy Notice.',
    ],
    'sections' => [
        [
            'id' => 'access',
            'title' => '1. Access control',
            'content' => 'Access to production systems and customer data is restricted to personnel who need it to operate the service. Accounts are protected by strong authentication, and platform sign-in supports passkeys and two-factor authentication for customers.',
        ],
        [
            'id' => 'transport',
            'title' => '2. Data in transit',
            'content' => 'Connections to the platform are served over HTTPS. Sites hosted with us receive SSL certificates, encrypted by default, at no additional cost.',
        ],
        [
            'id' => 'storage',
            'title' => '3. Data at rest',
            'content' => 'Customer data is stored on infrastructure operated for CloudHost247 services with account-level isolation. Access to storage systems is logged and limited to operational needs.',
        ],
        [
            'id' => 'backups',
            'title' => '4. Backups and recovery',
            'content' => 'Backup schedules, retention and restore scope are documented in our Backup Policy. Customers remain responsible for maintaining their own independent copies of critical data.',
        ],
        [
            'id' => 'incidents',
            'title' => '5. Incident handling',
            'content' => 'Suspected security incidents are triaged by our team, contained, and remediated. Where an incident affects customer data in a way that requires notification under applicable law, affected customers are informed without undue delay.',
        ],
        [
            'id' => 'retention',
            'title' => '6. Retention and deletion',
            'content' => 'Data is kept only as long as the service relationship and legal obligations require. Deletion requests are handled as described on our Data Deletion page.',
        ],
    ],
];

echo ch247_page([
    'title' => 'Data Protection Standards | CloudHost247',
    'description' => 'The technical and organizational measures CloudHost247 applies to protect customer data: access control, encryption, backups and incident handling.',
    'canonical' => 'data-protection-standards.php',
    'active' => 'company',
    'crumbs' => [['index.php', 'Home'], ['legal.php', 'Legal'], [null, 'Data Protection Standards']],
], ch247_page_head([['index.php', 'Home'], ['legal.php', 'Legal'], [null, 'Data Protection Standards']], 'Data Protection Standards', 'The concrete controls protecting your data — published, not promised.')
    . '<section class="section"><div class="container"><div class="card" style="padding:28px">' . ch247_policy_doc($doc) . '</div></div></section>');
