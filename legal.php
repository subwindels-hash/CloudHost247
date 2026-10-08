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
        'id'     => 'legal-notice',
        'title'  => 'Legal Notice',
        'desc'   => 'Company identification, liability limitations and legal disclaimers regarding the use of our platform, services, and published content.',
        'link'   => 'legal-notice.php',
        'icon'   => 'fa-exclamation-triangle',
    ],
    [
        'id'     => 'domain-agreement',
        'title'  => 'Domain Registration Agreement',
        'desc'   => 'Terms governing domain name registration, transfers, renewals, and ownership rights. Includes registrar obligations and registrant responsibilities.',
        'link'   => 'domain-agreement.php',
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
        'title'  => 'Cybercrime & Abuse Policy',
        'desc'   => 'How we detect, prevent, and respond to suspicious activity, abuse reports, and illegal use of our network and services.',
        'link'   => 'cybercrime-policy.php',
        'icon'   => 'fa-shield-alt',
    ],
    /*
     * Every remaining policy in the repository is indexed here. This page is how a visitor — and a
     * crawler — reaches the policies that are deliberately not in the footer, so a policy missing
     * from this list is a page nothing links to. `scripts/site/check-links.mjs` and
     * `scripts/audit-navigation-inventory.py` both fail when a policy is not reachable, which is
     * what keeps this list complete as documents are added.
     */
    [
        'id'     => 'data-protection-standards',
        'title'  => 'Data Protection Standards',
        'desc'   => 'The technical and organisational measures we apply to protect personal data, and the standards we hold ourselves to.',
        'link'   => 'data-protection-standards.php',
        'icon'   => 'fa-lock',
    ],
    [
        'id'     => 'data-deletion',
        'title'  => 'Data Deletion Policy',
        'desc'   => 'How to request deletion of your personal data, what we remove, and the records we are required to retain.',
        'link'   => 'data-deletion.php',
        'icon'   => 'fa-trash-alt',
    ],
    [
        'id'     => 'privacy-notice-and-consent',
        'title'  => 'Data Privacy Notice & Consent',
        'desc'   => 'The consent form and privacy notice used where processing requires your explicit agreement.',
        'link'   => 'data-privacy-notice-and-consent-form.php',
        'icon'   => 'fa-file-signature',
    ],
    [
        'id'     => 'refund-and-cancellation',
        'title'  => 'Refund & Cancellation Policy',
        'desc'   => 'How to cancel a service, when a refund is due, and how cancellation affects renewals and domain registrations.',
        'link'   => 'refund-and-cancellation-policy.php',
        'icon'   => 'fa-undo-alt',
    ],
    [
        'id'     => 'domain-renewal-policy',
        'title'  => 'Domain Renewal & Deletion Policy',
        'desc'   => 'Auto-renewal, grace periods and the point at which an unpaid domain is deleted.',
        'link'   => 'domain-renewal-policy.php',
        'icon'   => 'fa-clock',
    ],
    [
        'id'     => 'domain-registration-addendum',
        'title'  => 'Domain Registration Addendum',
        'desc'   => 'Additional registrar terms that apply to specific top-level domains and registry operators.',
        'link'   => 'domainregistrationaddendum.php',
        'icon'   => 'fa-file-alt',
    ],
    [
        'id'     => 'domain-brokerage-terms',
        'title'  => 'Domain Brokerage Terms',
        'desc'   => 'The terms that apply when we negotiate the purchase or sale of a domain name on your behalf.',
        'link'   => 'domain-brokerage-terms.php',
        'icon'   => 'fa-handshake',
    ],
    [
        'id'     => 'trademark',
        'title'  => 'Trademark & Copyright Policy',
        'desc'   => 'Brand usage rules and the procedure for reporting copyright or trademark infringement.',
        'link'   => 'trademark-policy.php',
        'icon'   => 'fa-copyright',
    ],
]);

$ca->setTemplate('legal');

$ca->output();
