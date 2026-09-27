<?php
/**
 * Terms & Conditions Page
 *
 * WHMCS ClientArea page for displaying CloudHost247 Isc Terms & Conditions.
 * Template: templates/hostx/termsofservice.tpl
 *
 * @package    WHMCS
 * @author     CloudHost247 Isc
 * @copyright  Copyright (c) CloudHost247 Isc
 * @license    Private
 */

// Prevent direct access
define('CLIENTAREA', true);

require_once __DIR__ . '/init.php';

use WHMCS\ClientArea;
use WHMCS\Session;

$ca = new ClientArea();

// Set page metadata
$ca->setPageTitle('Terms & Conditions');
$ca->addToBreadCrumb('index.php', $_LANG['globalsystemname'] ?? 'Home');
$ca->addToBreadCrumb('terms-of-service.php', 'Terms & Conditions');

// Determine if user is logged in
$isLoggedIn = $ca->isLoggedIn();
$clientName = '';

if ($isLoggedIn) {
    $client = WHMCS\User\Client::find($ca->getUserID());
    if ($client) {
        $clientName = $client->getFullName();
    }
}

// Assign Smarty variables for template use
$ca->assign('WEB_ROOT', $CONFIG['SystemURL'] ?? '');
$ca->assign('template', $ca->getClientAreaTemplate() ?? 'hostx');
$ca->assign('pageTitle', 'Terms & Conditions');
$ca->assign('isLoggedIn', $isLoggedIn);
$ca->assign('clientName', $clientName);
$ca->assign('effectiveDate', 'August 14, 2025');
$ca->assign('companyName', 'CloudHost247 Isc');
$ca->assign('supportEmail', 'support@cloudhost247.com');
$ca->assign('companyUrl', 'https://www.cloudhost247.com');
$ca->assign('jurisdiction', 'Federal Republic of Nigeria');

// Terms content sections
$ca->assign('termsSections', [
    'introduction' => [
        'heading' => 'Agreement Overview',
        'icon' => 'fa-file-contract',
        'content' => [
            'These Terms & Conditions ("Terms," "Agreement") govern your access to and use of our websites, products, and services (collectively, the "Services"). By accessing or using our Services, you agree to be bound by these Terms. If you do not agree with any part of these Terms, you may not access or use our Services.',
            '"We," "us," "our" refer to CloudHost247 Isc and its affiliates. "You," "your" refer to the customer, account holder, or user of our Services. "Services" refer to all hosting, domain registration, related IT services, and any other products we provide.'
        ]
    ],
    'account_terms' => [
        'heading' => 'Account Registration & Security',
        'icon' => 'fa-user-shield',
        'content' => [
            'You must be at least 18 years old and have the legal capacity to enter into a binding contract. You must provide accurate, complete, and up-to-date information when registering for our Services.',
            'You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You agree to notify us immediately of any unauthorized access or security breach.',
            'We reserve the right to suspend or terminate accounts if we suspect fraudulent or abusive activity.'
        ]
    ],
    'service_usage' => [
        'heading' => 'Service Usage Terms',
        'icon' => 'fa-server',
        'content' => [
            'You agree not to use our Services to violate any applicable laws or regulations, engage in spamming, phishing, or distribution of malware, host or transmit illegal, harmful, or obscene content, infringe intellectual property rights of others, or interfere with or disrupt the operation of our Services or networks.',
            'We reserve the right to remove content, suspend accounts, or terminate Services for violations. All content, trademarks, and materials on our website are owned by CloudHost247 Isc or our licensors. You are granted a limited, non-exclusive, non-transferable license to use our Services for personal or business purposes in accordance with these Terms.'
        ]
    ],
    'payments_billing' => [
        'heading' => 'Payments & Billing Terms',
        'icon' => 'fa-credit-card',
        'content' => [
            'All fees are due according to the billing cycle agreed upon during purchase. Payments must be made via accepted payment methods listed on our website.',
            'Failure to pay may result in suspension or termination of Services. All fees are non-refundable unless otherwise stated in our Refund Policy.',
            'We aim to provide 99.9% uptime for hosting services but do not guarantee uninterrupted service. Scheduled maintenance will be communicated in advance whenever possible. Emergency maintenance may be performed without notice.'
        ]
    ],
    'user_responsibilities' => [
        'heading' => 'User Responsibilities & Indemnification',
        'icon' => 'fa-user-check',
        'content' => [
            'You agree to use the Services only for lawful purposes and in compliance with all applicable laws and regulations. You are solely responsible for any content you upload, transmit, or store using our Services.',
            'You agree to indemnify, defend, and hold harmless CloudHost247 Isc, its employees, and affiliates from any claims, damages, or expenses arising from your use of the Services or violation of these Terms.',
            'Your use of our Services is subject to our Privacy Policy, which explains how we collect, use, and protect your personal information.'
        ]
    ],
    'limitations_liability' => [
        'heading' => 'Limitations of Liability',
        'icon' => 'fa-balance-scale',
        'content' => [
            'To the maximum extent permitted by law, CloudHost247 Isc shall not be liable for any indirect, incidental, or consequential damages. Our total liability for any claim shall not exceed the amount you paid for the Services in the 12 months prior to the claim.',
            'Our Services are provided "as is" and "as available" without warranties of any kind, either express or implied. We do not warrant that the Services will be error-free, secure, or uninterrupted.'
        ]
    ],
    'termination' => [
        'heading' => 'Termination Policy',
        'icon' => 'fa-times-circle',
        'content' => [
            'We may suspend or terminate your account if you violate these Terms, if payment is overdue, or if required by law or court order.',
            'You may terminate your account at any time by contacting our support team. Upon termination, your right to use the Services will immediately cease, and we may delete your data in accordance with our data retention policies.',
            'All provisions of these Terms which by their nature should survive termination shall survive termination, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability.'
        ]
    ],
    'contact' => [
        'heading' => 'Contact Information',
        'icon' => 'fa-envelope',
        'content' => [
            'For questions or concerns about these Terms, please contact our support team at support@cloudhost247.com or visit www.cloudhost247.com.',
            'These Terms are governed by the laws of the Federal Republic of Nigeria. Any disputes shall be subject to the jurisdiction of the Nigerian courts.',
            'We reserve the right to modify these Terms at any time. Changes will be posted on our website with an updated "Effective Date." Continued use of our Services after changes means you accept the new Terms.'
        ]
    ]
]);

// Parse and output using the termsofservice template
$ca->initPage();
$ca->setTemplate('termsofservice');

# Parse and output
$ca->output();
