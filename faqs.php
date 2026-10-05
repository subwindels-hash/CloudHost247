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

$faqItems = [
    [
        'id' => 'faq-1',
        'question' => 'What is CloudHost247?',
        'answer' => 'CloudHost247 is a professional web hosting and cloud solutions provider offering secure, reliable, and high-performance hosting, domain registration, and managed IT services for individuals, businesses, and organizations worldwide.'
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
        'question' => 'How do I transfer my website to CloudHost247?',
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
];

$itemsHtml = '';
foreach ($faqItems as $item) {
    $itemsHtml .= '<details class="card"><summary style="font-weight:700;cursor:pointer">'
        . ch247_e($item['question'] ?? '')
        . '</summary><div style="margin-top:10px">'
        . ($item['answer'] ?? '')
        . '</div></details>';
}

echo ch247_page([
    'title' => 'Frequently Asked Questions | CloudHost247',
    'description' => 'Answers to common questions about CloudHost247 hosting, domains, billing, support and account management.',
    'canonical' => 'faqs.php',
    'active' => 'resources',
    'crumbs' => [['index.php', 'Home'], [null, 'FAQs']],
    'jsonld' => [
        '@context' => 'https://schema.org',
        '@type' => 'FAQPage',
        'mainEntity' => array_map(static function ($item) {
            return [
                '@type' => 'Question',
                'name' => $item['question'] ?? '',
                'acceptedAnswer' => ['@type' => 'Answer', 'text' => strip_tags((string) ($item['answer'] ?? ''))],
            ];
        }, $faqItems),
    ],
], ch247_page_head([['index.php', 'Home'], [null, 'FAQs']], 'Frequently Asked Questions', 'Straight answers about our services, billing and support. If your question is not covered, open a ticket and a human will answer.')
    . '<section class="section"><div class="container" style="display:grid;gap:14px;max-width:880px">' . $itemsHtml . '</div></section>'
    . ch247_cta_band('Still have a question?', 'Our support team answers tickets personally — no bots, no canned replies.', 'Contact Support', 'help-center.php'));
