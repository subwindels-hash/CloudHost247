<?php
/**
 * WHMCS Client Area Refund Policy Page
 *
 * @package    WHMCS
 * @author     CloudHost247
 * @copyright  Copyright (c) CloudHost247, All Rights Reserved
 * @link       https://www.cloudhost247.com
 */

define('CLIENTAREA', true);
require __DIR__ . '/init.php';

use WHMCS\ClientArea;
use WHMCS\Authentication\CurrentUser;

$ca = new ClientArea();
$ca->setPageTitle('Refund Policy');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('refund-policy.php', 'Refund Policy');
$ca->initPage();

/**
 * ================================================================
 * REFUND POLICY DATA
 * ================================================================
 * Professional, legally appropriate refund policy content
 * structured for display within the CloudHost247 theme.
 * ================================================================
 */

$refundSections = [
    'hero' => [
        'title' => 'Refund Policy',
        'subtitle' => 'Effective Date: August 14, 2025',
    ],
    'introduction' => [
        'title' => '',
        'content' => 'At CloudHost247 Inc., we are committed to providing high-quality hosting, domain registration, and related services. We understand that sometimes circumstances change, and you may need to request a refund. This Refund Policy explains the terms under which refunds may be granted.'
    ],
    'sections' => [
        [
            'id' => 'eligibility',
            'title' => '1. Eligibility for Refunds',
            'content' => 'Refund requests are subject to the following conditions:',
            'items' => [
                'Refunds are only available for certain products and services as specified in this policy.',
                'All refund requests must be made within the applicable refund period for each product or service.',
                'Refunds will be issued only to the original payment method used for the purchase.',
                'Accounts must be in good standing with no outstanding invoices or abuse violations to qualify for a refund.',
            ]
        ],
        [
            'id' => 'hosting',
            'title' => '2. Hosting Services Refunds',
            'content' => 'Our hosting refund terms vary by service type:',
            'items' => [
                '<strong>Shared Hosting & Reseller Hosting:</strong> Eligible for a full refund if cancelled within 30 days of the initial purchase.',
                '<strong>VPS Hosting & Dedicated Servers:</strong> Eligible for a partial refund if cancelled within 7 days of purchase. After 7 days, no refunds will be provided.',
                '<strong>Renewals:</strong> All hosting service renewals are non-refundable once processed.',
                '<strong>Add-ons & Upgrades:</strong> Prorated refunds may be issued for unused portions of certain upgrade services, subject to review.',
            ]
        ],
        [
            'id' => 'nonrefundable',
            'title' => '3. Non-Refundable Services',
            'content' => 'The following services are non-refundable once purchased, activated, or provisioned:',
            'items' => [
                'Domain name registrations, renewals, or transfers.',
                'SSL certificates once issued or installed.',
                'Any service that has been customized or specifically provisioned for your requirements.',
                'Setup fees, one-time service fees, and administrative charges.',
                'Any service suspended or terminated due to violation of our Terms & Conditions or Acceptable Use Policy.',
                'Software licenses, third-party add-ons, and marketplace purchases.',
            ]
        ],
        [
            'id' => 'domains',
            'title' => '4. Domain Name Refunds',
            'content' => 'Due to the nature of domain name registration and real-time registry processing, domain names cannot be refunded once registered, renewed, or transferred, except where explicitly required by ICANN policies or applicable law. We strongly recommend verifying all domain spelling and extension selections before completing your order.'
        ],
        [
            'id' => 'process',
            'title' => '5. Refund Request Process',
            'content' => 'To request a refund, please follow these steps:',
            'items' => [
                'Contact our Billing Department via support ticket or email at <a href="mailto:billing@cloudhost247.com">billing@cloudhost247.com</a>.',
                'Provide your account information, order number, service details, and a clear reason for the refund request.',
                'Allow up to 48 hours for our billing team to review and respond to your request.',
                'Approved refunds will be processed within 7–14 business days to the original payment method used during purchase.',
                'You will receive email confirmation once your refund has been initiated.',
            ]
        ],
        [
            'id' => 'processing',
            'title' => '6. Processing Time',
            'content' => 'Once a refund is approved, the processing timeline is as follows:',
            'items' => [
                '<strong>Internal Processing:</strong> 3–5 business days for our team to finalize the refund.',
                '<strong>Payment Method Timeline:</strong> Credit/Debit cards may take 7–14 business days to reflect, depending on your issuing bank. PayPal refunds typically appear within 3–5 business days. Cryptocurrency refunds are processed at the prevailing exchange rate at the time of refund.',
                'Bank holidays and weekends may extend processing times.',
            ]
        ],
        [
            'id' => 'promotional',
            'title' => '7. Promotional & Discounted Purchases',
            'content' => 'If you purchase a service under a promotional, discounted, or trial rate, refunds will be calculated based on the standard, non-discounted price of the service for any usage period prior to cancellation. Promotional credits, coupon discounts, and bonus months are non-transferable and non-refundable.'
        ],
        [
            'id' => 'chargebacks',
            'title' => '8. Chargebacks Policy',
            'content' => 'We strongly encourage customers to contact our billing team to resolve any billing concerns before initiating a chargeback with their financial institution. If you initiate a chargeback without first contacting us:',
            'items' => [
                'Your account and all associated services may be immediately suspended or terminated.',
                'Any applicable chargeback fees, retrieval fees, or administrative costs will be your responsibility.',
                'A chargeback does not automatically guarantee a refund; we reserve the right to dispute fraudulent or erroneous chargeback claims.',
                'Repeated chargebacks may result in permanent account closure and reporting to relevant fraud monitoring services.',
            ]
        ],
        [
            'id' => 'exceptions',
            'title' => '9. Exceptions & Special Circumstances',
            'content' => 'In exceptional circumstances, CloudHost247 Inc. reserves the right to grant or deny refunds outside the scope of this standard policy. Such circumstances include, but are not limited to:',
            'items' => [
                'Prolonged service outages caused by infrastructure failures on our end.',
                'Billing errors or duplicate charges caused by system malfunction.',
                'Fraudulent account activity or unauthorized transactions verified through investigation.',
                'Force majeure events affecting service delivery.',
            ]
        ],
        [
            'id' => 'updates',
            'title' => '10. Policy Updates',
            'content' => 'We reserve the right to update or modify this Refund Policy at any time. Changes will be posted on our website with an updated Effective Date. Continued use of our Services after changes constitutes acceptance of the updated policy. Customers are encouraged to review this policy periodically.'
        ],
    ],
    'contact' => [
        'title' => 'Contact Us',
        'content' => 'If you have any questions regarding our Refund Policy, or if you would like to discuss a refund request, please contact our Billing Department:',
        'email' => 'billing@cloudhost247.com',
        'website' => 'www.cloudhost247.com',
        'portal' => 'support portal',
    ]
];

$ca->assign('refundData', $refundSections);
$ca->setTemplate('refundpolicy');
$ca->output();
