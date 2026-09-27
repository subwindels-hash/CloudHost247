<?php
/**
 * CloudHost247 Isc - Frequently Asked Questions (FAQs)
 *
 * @package    WHMCS
 * @author     CloudHost247 Isc
 * @copyright  Copyright (c) CloudHost247 Isc
 * @license    https://www.cloudhost247.com/license
 */

use WHMCS\ClientArea;
use WHMCS\Authentication\CurrentUser;

require_once __DIR__ . '/init.php';

$ca = new ClientArea();

// Set page title
$ca->setPageTitle('Frequently Asked Questions');

// Add breadcrumb
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('faqs.php', 'Frequently Asked Questions');

// Initialize template
$ca->initPage();

// Assign FAQ data to template
$ca->assign('faqItems', [
    [
        'id' => 'faq-1',
        'question' => 'What is CloudHost247 Isc?',
        'answer' => 'CloudHost247 Isc is a professional web hosting and cloud solutions provider offering secure, reliable, and high-performance hosting, domain registration, and managed IT services for individuals, businesses, and organizations worldwide.'
    ],
    [
        'id' => 'faq-2',
        'question' => 'What services do you offer?',
        'answer' => 'We provide: <ul><li>Shared, VPS, and Dedicated Hosting</li><li>Cloud Hosting Solutions</li><li>Domain Registration and Management</li><li>Website Security and SSL Certificates</li><li>Managed Server Support</li><li>Email Hosting</li><li>Data Backup and Recovery Services</li></ul>'
    ],
    [
        'id' => 'faq-3',
        'question' => 'How do I create an account?',
        'answer' => 'Visit our website at <a href="https://www.cloudhost247.com" target="_blank">www.cloudhost247.com</a>, click Sign Up, and follow the on-screen instructions. Once you complete the registration, you\'ll receive an email confirmation.'
    ],
    [
        'id' => 'faq-4',
        'question' => 'How can I pay for my services?',
        'answer' => 'We accept multiple payment methods, including: <ul><li>Credit/Debit Cards</li><li>PayPal</li><li>Bank Transfers</li><li>Cryptocurrency (Bitcoin, Ethereum where applicable)</li></ul>'
    ],
    [
        'id' => 'faq-5',
        'question' => 'Do you offer refunds?',
        'answer' => 'Yes, we have a Refund Policy that applies to eligible services. Refund requests must be submitted within the specified refund period stated in our Refund Policy.'
    ],
    [
        'id' => 'faq-6',
        'question' => 'How do I cancel my account or services?',
        'answer' => 'You can cancel your account by: <ul><li>Logging into your Client Area and submitting a cancellation request</li><li>Contacting our support team via email at <a href="mailto:support@cloudhost247.com">support@cloudhost247.com</a></li></ul>'
    ],
    [
        'id' => 'faq-7',
        'question' => 'How do I request data deletion?',
        'answer' => 'Refer to our Data Deletion Instructions. You\'ll need to email <a href="mailto:privacy@cloudhost247.com">privacy@cloudhost247.com</a> with your account details, and we\'ll process your request in accordance with our Data Protection Standards.'
    ],
    [
        'id' => 'faq-8',
        'question' => 'Do you keep my personal information safe?',
        'answer' => 'Absolutely. We follow strict Data Protection Standards that comply with GDPR, CCPA, and other regulations. Your data is encrypted, stored securely, and never sold to third parties.'
    ],
    [
        'id' => 'faq-9',
        'question' => 'Do you provide 24/7 customer support?',
        'answer' => 'Yes, our support team is available 24/7/365 via: <ul><li>Email: <a href="mailto:support@cloudhost247.com">support@cloudhost247.com</a></li><li>Live Chat (on our website)</li><li>Support Tickets in the Client Area</li></ul>'
    ],
    [
        'id' => 'faq-10',
        'question' => 'How do I transfer my website to CloudHost247 Isc?',
        'answer' => 'We offer free migration assistance for most hosting plans. Simply contact our support team with your current hosting details, and we\'ll handle the transfer for you.'
    ],
    [
        'id' => 'faq-11',
        'question' => 'What happens if my website gets hacked?',
        'answer' => 'If your website is compromised, our security team can assist with malware removal, security patches, and restoration from backups (if backups are active on your account).'
    ],
    [
        'id' => 'faq-12',
        'question' => 'Where can I read your full policies?',
        'answer' => 'All our policies, including Privacy Policy, Terms & Conditions, Refund Policy, Cookie Policy, and Data Protection Standards, are available on our website at <a href="https://www.cloudhost247.com/legal" target="_blank">www.cloudhost247.com/legal</a>.'
    ]
]);

// Output template
$ca->setTemplate('faqs');
$ca->output();
