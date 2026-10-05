<?php
/**
 * Legal & Policy Center
 *
 * Centralized legal hub page that brings together all key legal,
 * privacy, and policy documents for the platform.
 *
 * @package    WHMCS
 * @copyright  Copyright (c) WHMCS Limited 2025
 * @license    MIT License
 */

use WHMCS\ClientArea;

define('CLIENTAREA', true);

require __DIR__ . '/init.php';

$ca = new ClientArea();

$ca->setPageTitle('Legal & Policy Center');

$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('legal.php', 'Legal & Policy Center');

$ca->initPage();

$ca->assign('legalSections', [
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
]);

$ca->setTemplate('legal');

$ca->output();
