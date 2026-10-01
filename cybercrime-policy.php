<?php
/**
 * WHMCS Client Area Cybercrime Detection Policy Page
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
$ca->setPageTitle('Cybercrime Detection Policy');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('cybercrime-policy.php', 'Cybercrime Detection Policy');
$ca->initPage();

/**
 * ================================================================
 * CYBERCRIME DETECTION POLICY DATA
 * ================================================================
 * Professional policy covering monitoring, detection, fraud
 * prevention, data collection, automated systems, user obligations,
 * reporting, enforcement, privacy, and updates.
 * ================================================================
 */

$cybercrimeSections = [
    'hero' => [
        'title' => 'Cybercrime Detection Policy',
        'subtitle' => 'Last Updated: April 26, 2026',
    ],
    'introduction' => [
        'content' => 'CloudHost247 Isc. ("the Company") is committed to ensuring that all domains registered, hosted, or managed on our platform are not used for illegal, fraudulent, or malicious activities. This Cybercrime Detection Policy explains the preventive and detection measures we employ to identify suspicious or fraudulent activity, the procedures for handling complaints related to cybercrime or abuse, and how individuals and organizations can report concerns involving services hosted on our platform.'
    ],
    'sections' => [
        [
            'id' => 'scope',
            'title' => '1. Scope',
            'content' => 'This policy applies to:',
            'items' => [
                'All employees, contractors, and agents of CloudHost247 Isc.',
                'All visitors, users, and account holders of the Platform.',
                'All registered clients, registrants, and domain owners.',
                'All complainants, law enforcement agencies, and third-party reporting parties.',
            ]
        ],
        [
            'id' => 'fraud-definition',
            'title' => '2. Fraudulent Activity Definition',
            'content' => 'A fraudulent domain or service refers to any domain name, website, or hosted resource used to carry out fraud, deception, or any form of cybercrime. This includes, but is not limited to:',
            'items' => [
                'Identity theft, impersonation, or social engineering websites.',
                'Cyberterrorism-related activities or material promoting violence and extremism.',
                'Forgery, document falsification, or counterfeit credential services.',
                'Advance fee fraud schemes, phishing, and spoofing operations.',
                'Online financial scams, Ponzi schemes, and investment fraud platforms.',
                'Domains designed to imitate banks, fintech platforms, payment processors, or recognized financial institutions.',
                'Distribution of malware, ransomware, spyware, or botnet command infrastructure.',
                'Illegal marketplaces, trade of stolen data, or trafficking in prohibited goods and services.',
            ]
        ],
        [
            'id' => 'monitoring',
            'title' => '3. Monitoring & Detection',
            'content' => 'CloudHost247 Isc. employs a multi-layered approach to monitor and detect suspicious activity across our infrastructure:',
            'items' => [
                '<strong>Network Monitoring:</strong> Our systems continuously analyze network traffic for anomalous patterns, including unusual outbound connections, high-volume data transfers, and known malicious IP associations.',
                '<strong>Abuse Team Reviews:</strong> The CloudHost247 Isc. Abuse Team conducts regular monitoring and security reviews of domains and services hosted on the Platform to identify suspicious or potentially fraudulent activity.',
                '<strong>Behavioral Analysis:</strong> We monitor account behavior for indicators of compromise, such as unexpected login locations, brute-force attempts, and credential-stuffing patterns.',
                '<strong>Third-Party Intelligence:</strong> We subscribe to reputable threat intelligence feeds, blocklists, and security advisories to identify known fraudulent domains and emerging attack vectors.',
                '<strong>Registrant Verification:</strong> New registrations and high-risk orders are subject to automated and manual verification checks to confirm legitimacy before full service activation.',
            ]
        ],
        [
            'id' => 'data-collection',
            'title' => '4. Data Collection for Detection',
            'content' => 'To effectively detect and prevent cybercrime, CloudHost247 Isc. may collect and analyze the following categories of data:',
            'items' => [
                '<strong>Server & Access Logs:</strong> HTTP request logs, authentication logs, FTP/SFTP access records, and control panel login history.',
                '<strong>Network Data:</strong> IP addresses, geolocation data, ASN information, connection timestamps, and bandwidth usage patterns.',
                '<strong>Account Metadata:</strong> Registration details, payment method verification data, contact information, and order history.',
                '<strong>Content Hashes:</strong> Cryptographic hashes of hosted files compared against databases of known malicious content to detect malware distribution without accessing file contents directly.',
                '<strong>Communication Records:</strong> Support tickets, abuse reports, and correspondence related to security incidents.',
            ]
        ],
        [
            'id' => 'automated',
            'title' => '5. Automated Detection Systems',
            'content' => 'CloudHost247 Isc. utilizes automated tools and artificial intelligence systems to enhance threat detection capabilities:',
            'items' => [
                '<strong>Anomaly Detection Engines:</strong> AI-powered systems analyze traffic baselines and flag deviations that may indicate compromise, DDoS activity, or unauthorized resource usage.',
                '<strong>Malware Scanning:</strong> Automated file scanning services periodically inspect hosted content for known malware signatures, shell scripts, and suspicious code patterns.',
                '<strong>Phishing Detection:</strong> Machine learning models evaluate domain names, page content, and visual similarity to detect phishing sites impersonating trusted brands.',
                '<strong>Spam & Abuse Filters:</strong> Email traffic is monitored through automated filtering to detect outgoing spam, spoofing, and email-based fraud campaigns.',
                '<strong>Rate Limiting & Blocking:</strong> Automated systems enforce rate limits and may temporarily block IPs exhibiting brute-force, scanning, or denial-of-service behavior.',
            ]
        ],
        [
            'id' => 'user-responsibilities',
            'title' => '6. User Responsibilities',
            'content' => 'All customers and users of CloudHost247 Isc. services are expected to comply with the law and our Acceptable Use Policy. Specifically, you must NOT:',
            'items' => [
                'Use our services to host, distribute, promote, or facilitate any illegal, fraudulent, or harmful activity.',
                'Register domains or create services designed to deceive, impersonate, or defraud third parties.',
                'Upload, transmit, or store malware, exploit kits, stolen credentials, or illegal content.',
                'Launch or participate in denial-of-service attacks, port scanning, or unauthorized intrusion attempts.',
                'Send unsolicited bulk email (spam), phishing messages, or engage in email spoofing.',
                'Attempt to circumvent our monitoring, security controls, or abuse detection mechanisms.',
                'Provide false, misleading, or stolen identity information during account registration.',
            ]
        ],
        [
            'id' => 'reporting',
            'title' => '7. Reporting Cybercrime & Suspicious Activity',
            'content' => 'If any individual or organization suspects that a domain or service hosted on CloudHost247 Isc. is being used for fraudulent or criminal purposes, please report it promptly:',
            'items' => [
                '<strong>Email:</strong> Send a detailed report to <a href="mailto:support@cloudhost247.com">support@cloudhost247.com</a> or <a href="mailto:abuse@cloudhost247.com">abuse@cloudhost247.com</a>.',
                '<strong>Subject Line:</strong> Use "Cybercrime Report" or "Abuse Complaint" for faster routing.',
                '<strong>Required Details:</strong> Your name and contact information; the domain name, IP address, or service identifier in question; a description of the suspected activity; evidence or screenshots, if available; and any relevant timestamps or transaction IDs.',
                '<strong>Confidentiality:</strong> Reporter identity is kept confidential to the extent permitted by law. We do not disclose complainant contact details to the accused party unless legally required.',
            ]
        ],
        [
            'id' => 'investigation',
            'title' => '8. Investigation Process',
            'content' => 'Upon receipt of a complaint or detection of suspicious activity, the Abuse Team will:',
            'items' => [
                'Review and assess the report or alert within 24–48 hours.',
                'Notify the affected registrant or account holder when necessary, requesting clarification or supporting documentation.',
                'Request verification materials (business registration, identity documents, or proof of legitimate use) where domain purpose is in question.',
                'If the registrant provides valid and verifiable information confirming legitimate use, the domain or service will remain active.',
                'If the registrant fails to respond within 7 working days, or cannot prove legitimate use, the Company reserves the right to suspend the domain immediately or terminate associated hosting services.',
            ]
        ],
        [
            'id' => 'enforcement',
            'title' => '9. Enforcement Actions',
            'content' => 'CloudHost247 Isc. reserves the right to take the following actions when cybercrime, fraud, or abuse is confirmed:',
            'items' => [
                '<strong>Temporary Suspension:</strong> Immediate suspension of the domain, website, or service to prevent ongoing harm while the investigation proceeds.',
                '<strong>Permanent Termination:</strong> Complete termination of hosting services, domain resolution, and account access for confirmed violations.',
                '<strong>Data Preservation:</strong> Retention of relevant logs and content for a reasonable period to support law enforcement investigations.',
                '<strong>Law Enforcement Reporting:</strong> Serious cases may, at our discretion, be escalated to relevant local, national, or international law enforcement authorities.',
                '<strong>Network Restrictions:</strong> IP addresses or ranges associated with malicious activity may be blocked at the network edge to protect other customers.',
                '<strong>No Refunds:</strong> Accounts terminated for cybercrime or abuse violations forfeit any right to refund for prepaid services.',
            ]
        ],
        [
            'id' => 'privacy',
            'title' => '10. Privacy Considerations',
            'content' => 'All monitoring and detection activities are conducted with respect for user privacy and in compliance with applicable data protection laws:',
            'items' => [
                'Monitoring is narrowly scoped to detect security threats, fraud, and violations of our Acceptable Use Policy.',
                'We do not access private customer data, emails, or databases without a valid legal basis, such as a court order, or explicit customer consent for support purposes.',
                'Data collected for security purposes is retained only for the duration necessary to fulfill the detection, investigation, and any legal obligations.',
                'Registrant contact details are disclosed only when legally required through a valid court order or formal law enforcement request.',
                'We comply with applicable data protection regulations, including but not limited to GDPR, CCPA, and relevant national privacy statutes.',
            ]
        ],
        [
            'id' => 'updates',
            'title' => '11. Policy Updates',
            'content' => 'CloudHost247 Isc. reserves the right to update or modify this Cybercrime Detection Policy at any time to reflect changes in technology, threat landscapes, legal requirements, or operational practices. Updates will be posted on this page with a revised effective date. Continued use of our services after changes constitutes acceptance of the updated policy. We encourage all users and stakeholders to review this policy periodically.'
        ],
    ],
    'contact' => [
        'title' => 'Contact Information',
        'content' => 'To report abuse, fraud, or suspicious activity involving any service hosted on CloudHost247 Isc., or if you have questions about this policy, please contact our Abuse and Security Team:',
        'email' => 'abuse@cloudhost247.com',
        'email_secondary' => 'support@cloudhost247.com',
        'website' => 'www.cloudhost247.com',
        'portal' => 'support portal',
    ]
];

$ca->assign('cybercrimeData', $cybercrimeSections);
$ca->setTemplate('cybercrimepolicy');
$ca->output();
