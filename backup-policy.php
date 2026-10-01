<?php
/**
 * WHMCS Client Area Backup Policy Page
 *
 * @package    WHMCS
 * @author     CloudHost247
 * @copyright  Copyright (c) CloudHost247 Isc., All Rights Reserved
 * @link       https://www.cloudhost247.com
 */

define('CLIENTAREA', true);
require __DIR__ . '/init.php';

use WHMCS\ClientArea;
use WHMCS\Authentication\CurrentUser;

$ca = new ClientArea();
$ca->setPageTitle('Backup Policy');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('backup-policy.php', 'Backup Policy');
$ca->initPage();

/**
 * ================================================================
 * BACKUP POLICY DATA
 * ================================================================
 * Professional backup policy content covering provider and user
 * responsibilities, schedules, retention, and liability.
 * ================================================================
 */

$backupSections = [
    'hero' => [
        'title' => 'Backup Policy',
        'subtitle' => 'Last Updated: April 26, 2026',
    ],
    'introduction' => [
        'content' => 'This Backup Policy outlines the backup practices and responsibilities for services provided by CloudHost247 Isc. Our goal is to safeguard customer data through systematic backup procedures while clearly defining the boundaries of provider responsibility and user obligations. Please review this policy carefully to understand how your data is protected and what steps you should take to maintain your own independent copies.'
    ],
    'sections' => [
        [
            'id' => 'responsibility',
            'title' => '1. Backup Responsibility',
            'content' => 'Backup responsibility is shared between CloudHost247 Isc. and our customers:',
            'items' => [
                '<strong>Provider Responsibility:</strong> CloudHost247 Isc. performs automated backups of hosting server environments as a courtesy and disaster-recovery measure. These backups are intended to restore service continuity in the event of hardware failure, system-level corruption, or catastrophic infrastructure events.',
                '<strong>User Responsibility:</strong> Customers are ultimately responsible for maintaining their own independent backups of all website files, databases, emails, and application data hosted on our infrastructure. Our automated backups should not be relied upon as your sole or primary data protection strategy.',
                '<strong>Scope:</strong> Provider-managed backups cover server-level restore points and do not extend to individual file recovery, email restoration for deleted mailboxes, or granular database table recovery unless explicitly stated in your service plan.',
            ]
        ],
        [
            'id' => 'frequency',
            'title' => '2. Backup Frequency',
            'content' => 'Automated backups are performed according to the following schedule:',
            'items' => [
                '<strong>Shared Hosting & Reseller Hosting:</strong> Daily incremental backups with a full weekly backup consolidation performed every Sunday at 02:00 UTC.',
                '<strong>VPS Hosting:</strong> Weekly full snapshots captured every Saturday at 03:00 UTC. VPS customers may optionally configure more frequent snapshots through the control panel at additional cost.',
                '<strong>Dedicated Servers:</strong> Backup frequency depends on the managed support tier selected at purchase. Standard managed plans include weekly backups; premium managed plans include daily backups. Self-managed dedicated servers do not include provider backups unless a separate backup add-on is purchased.',
                '<strong>Databases:</strong> MySQL/MariaDB databases on shared and reseller hosting are included in the daily backup cycle. Standalone database services are backed up according to the hosting tier schedule.',
            ]
        ],
        [
            'id' => 'retention',
            'title' => '3. Data Retention',
            'content' => 'Backup retention periods vary by service type:',
            'items' => [
                '<strong>Shared & Reseller Hosting:</strong> Daily backups retained for 7 days; weekly backups retained for 30 days.',
                '<strong>VPS Snapshots:</strong> Weekly snapshots retained for 14 days. Additional snapshot slots may be purchased to extend retention.',
                '<strong>Dedicated Server Backups:</strong> Standard managed backups retained for 14 days; premium managed backups retained for 30 days.',
                '<strong>Expired or Cancelled Accounts:</strong> All backups associated with a cancelled, terminated, or expired account are permanently deleted within 72 hours of service deactivation. No backups are retained for inactive accounts.',
                '<strong>Overwritten Data:</strong> Backups operate on a rolling rotation cycle. Once a backup cycle completes and new data overwrites older restore points, the previous data cannot be recovered.',
            ]
        ],
        [
            'id' => 'restoration',
            'title' => '4. Restoration Policy',
            'content' => 'If you require data restoration, the following process and limitations apply:',
            'items' => [
                '<strong>Restoration Requests:</strong> Submit a support ticket through the client portal specifying the service, approximate date of the data you need restored, and the reason for the request.',
                '<strong>Processing Time:</strong> Standard restoration requests are processed within 24–48 hours during business days. Emergency restoration requests may incur additional fees.',
                '<strong>Restoration Scope:</strong> Provider backups are restored at the account or server level. We do not perform selective file-by-file, folder-level, or individual email restorations from system backups. Users requiring granular recovery should maintain their own independent backups.',
                '<strong>Cost:</strong> Restorations from standard backup cycles are included at no charge for managed services. Restorations outside normal retention windows, or restorations for self-managed services without an active backup add-on, may be subject to hourly technical labor fees.',
                '<strong>No Guarantee:</strong> While we make every reasonable effort to maintain backup integrity, we cannot guarantee the availability, completeness, or usability of any specific restore point at the time of request.',
            ]
        ],
        [
            'id' => 'limitations',
            'title' => '5. Limitations & Liability',
            'content' => 'CloudHost247 Isc. provides backups on a best-effort basis. The following limitations apply:',
            'items' => [
                'Our backup systems are designed for disaster recovery, not as a substitute for customer-owned data protection strategies.',
                'We are not liable for any data loss, business interruption, revenue loss, or consequential damages arising from backup failure, incomplete backups, delayed restoration, or backup unavailability.',
                'Backups may not capture data corrupted before the backup window, data deleted by the customer, or data modified between backup intervals.',
                'We do not back up content that violates our Acceptable Use Policy, including malware, pirated material, or illegal content. Such content may be excluded from backups without notice.',
                'Maximum aggregate liability for any backup-related claim is limited to the pro-rated monthly service fee for the affected service.',
            ]
        ],
        [
            'id' => 'user-responsibility',
            'title' => '6. User Responsibility',
            'content' => 'All customers are strongly encouraged and expected to:',
            'items' => [
                'Maintain regular, independent backups of all critical data stored on our servers, including website files, databases, and email content.',
                'Use available control panel tools (such as cPanel Backup Wizard, phpMyAdmin exports, or FTP downloads) to create and download personal backup copies.',
                'Test restoration procedures periodically to ensure your independent backups are valid and usable.',
                'Store at least one copy of critical backups in an off-site or geographically separate location.',
                'Understand that relying solely on provider-managed backups places your data at risk and is not recommended for business-critical applications.',
            ]
        ],
        [
            'id' => 'updates',
            'title' => '7. Policy Updates',
            'content' => 'CloudHost247 Isc. reserves the right to update or modify this Backup Policy at any time. Changes may include adjustments to backup frequency, retention periods, restoration procedures, or scope of coverage. Updates will be posted on this page with a revised effective date. Continued use of our services after policy changes constitutes acceptance of the updated terms. We encourage customers to review this policy periodically.'
        ],
    ],
    'contact' => [
        'title' => 'Contact Us',
        'content' => 'If you have any questions regarding our Backup Policy, or if you need assistance with data restoration, please contact our support team:',
        'email' => 'support@cloudhost247.com',
        'website' => 'www.cloudhost247.com',
        'portal' => 'support portal',
    ]
];

$ca->assign('backupData', $backupSections);
$ca->setTemplate('backuppolicy');
$ca->output();
