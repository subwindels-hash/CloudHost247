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

$trademarkSections = [
    'hero' => [
        'title' => 'Trademark & Copyright Infringement Policy',
        'subtitle' => 'Last Updated: April 26, 2026',
    ],
    'introduction' => [
        'content' => 'At CloudHost247 Isc., we respect and are committed to protecting intellectual property rights. This policy outlines how we review and respond to claims of trademark and copyright infringement, and how we assist rights holders in protecting their legal interests. By using our services, all customers agree to comply with applicable intellectual property laws and to refrain from hosting, distributing, or promoting content that infringes upon the rights of third parties.'
    ],
    'sections' => [
        [
            'id' => 'ip-rights',
            'title' => '1. Intellectual Property Rights',
            'content' => 'CloudHost247 Isc. acknowledges that trademarks, copyrights, trade secrets, patents, and other forms of intellectual property are valuable legal rights protected under national and international law. We do not condone the unauthorized use, reproduction, distribution, or display of copyrighted works, nor do we permit the misuse of registered trademarks, service marks, or trade names in connection with our hosting services. All content hosted by our customers must either be original, properly licensed, or fall within a recognized legal exception such as fair use or fair dealing.'
        ],
        [
            'id' => 'domain-disputes',
            'title' => '2. Domain Name Dispute Claims',
            'content' => 'This policy applies to disputes involving CloudHost247 Isc. products and services, excluding domain name disputes, which are governed by separate dispute resolution procedures:',
            'items' => [
                '<strong>General Domain Disputes:</strong> Refer to the Uniform Domain Name Dispute Resolution Policy (UDRP). All such claims must be submitted to an ICANN-approved dispute resolution provider.',
                '<strong>.ng Domain Names:</strong> Disputes involving Nigerian country-code domains must be directed to the Nigeria Internet Registration Association (NIRA) and resolved in accordance with the NIRA Complaints Policy.',
                '<strong>Our Role:</strong> CloudHost247 Isc. does not adjudicate domain name disputes. We will comply with valid court orders and UDRP/NIRA determinations as required by registry agreements and applicable law.',
            ]
        ],
        [
            'id' => 'trademark-claims',
            'title' => '3. Trademark Infringement Policy',
            'content' => 'CloudHost247 Isc. respects the trademark rights of others and expects our customers to do the same. Trademark infringement occurs when a party uses a mark that is identical or confusingly similar to a registered or common-law trademark in a manner that is likely to cause confusion, deception, or mistake about the source, origin, or sponsorship of goods or services. We will investigate and respond to valid trademark infringement complaints submitted in accordance with the requirements below.'
        ],
        [
            'id' => 'reporting-trademark',
            'title' => '4. Reporting Trademark Infringement',
            'content' => 'To report a trademark infringement, send an email to <a href="mailto:abuse@cloudhost247.com">abuse@cloudhost247.com</a> with the subject line: <strong>"Trademark Claim"</strong>. Your complaint must include the following information:',
            'items' => [
                'Full legal name, physical mailing address, email address, and phone number of the trademark owner or their authorized representative.',
                'A copy of the trademark registration certificate or official acceptance letter from the relevant trademark office. If relying on common-law rights, provide evidence of first use in commerce and geographic scope.',
                'The date the trademark was first used and the jurisdictions in which it is registered or recognized.',
                'A detailed description of how the trademark is being infringed, including the specific content, URL, or service identifier involved.',
                'Full contact details (name, address, email, phone) of the alleged infringer, if known.',
                'Evidence demonstrating that the alleged infringer is a CloudHost247 Isc. customer, such as IP addresses, domain names, or account identifiers.',
                'A statement, made under penalty of perjury, that the information in your complaint is accurate and that you are the trademark owner or authorized to act on the owner\'s behalf.',
                'Your electronic or physical signature.',
            ]
        ],
        [
            'id' => 'copyright-claims',
            'title' => '5. Copyright Infringement & DMCA',
            'content' => 'CloudHost247 Isc. complies with the Digital Millennium Copyright Act (DMCA) and other applicable copyright laws. We will respond to notices of alleged copyright infringement that comply with statutory requirements. Copyright infringement includes the unauthorized reproduction, distribution, display, or creation of derivative works of copyrighted material without the express permission of the copyright owner.'
        ],
        [
            'id' => 'reporting-copyright',
            'title' => '6. Reporting Copyright Infringement',
            'content' => 'To submit a copyright infringement complaint, email <a href="mailto:abuse@cloudhost247.com">abuse@cloudhost247.com</a> with the subject line: <strong>"Copyright Claim"</strong>. Your submission must include:',
            'items' => [
                'Identification of the copyrighted work being infringed, including title, author, registration number (if applicable), and a description sufficient to locate the work.',
                'Proof of copyright registration, such as a certificate from the U.S. Copyright Office or equivalent authority, or a clear statement of ownership if registration is pending or not required in your jurisdiction.',
                'A description or direct URL locating the infringing material hosted by a CloudHost247 Isc. customer, with sufficient detail for us to locate and verify the content.',
                'Full contact details of the copyright owner or authorized agent (name, physical address, email address, and phone number).',
                'Contact details of the alleged infringer, if known (name, address, email, phone).',
                'A statement that you have a good-faith belief that the use of the material is not authorized by the copyright owner, its agent, or the law.',
                'A statement, made under penalty of perjury, that the information in your notification is accurate and that you are the copyright owner or authorized to act on behalf of the owner.',
                'Your electronic or physical signature.',
            ]
        ],
        [
            'id' => 'actions',
            'title' => '7. Action We May Take',
            'content' => 'Upon receipt of a valid trademark or copyright complaint, CloudHost247 Isc. will:',
            'items' => [
                'Acknowledge receipt of the complaint within 2 business days and assign it a tracking reference.',
                'Investigate the claim, which may include reviewing the reported content, verifying the complainant\'s ownership documentation, and examining the accused party\'s account history.',
                'Forward the complaint to the accused customer and notify them of the allegation, providing a reasonable opportunity to respond.',
                'Temporarily restrict access to, disable, or remove the disputed material during the investigation period to prevent ongoing harm.',
                'If the claim is validated, permanently remove or suspend access to the infringing material, and may suspend or terminate the offending customer account.',
                'If the claim is found to be invalid, mistaken, or unsubstantiated, restore access to the material promptly and notify both parties of the outcome.',
                'Cooperate with law enforcement and courts by preserving evidence and providing records as required by valid legal process.',
            ]
        ],
        [
            'id' => 'repeat-infringers',
            'title' => '8. Repeat Infringer Policy',
            'content' => 'CloudHost247 Isc. reserves the right to suspend or terminate accounts of users who are repeatedly found to violate intellectual property rights, including copyright and trademark infringement. A "repeat infringer" is defined as any customer who has received two or more valid infringement complaints within any rolling twelve-month period. Termination may occur without prior notice in cases of egregious, willful, or commercially motivated infringement. Accounts terminated under this policy forfeit any right to refund for prepaid services.'
        ],
        [
            'id' => 'counter-notification',
            'title' => '9. Counter-Notification Process',
            'content' => 'If you believe content was removed or disabled due to a mistake or misidentification, you may submit a counter-notification. To do so, email <a href="mailto:abuse@cloudhost247.com">abuse@cloudhost247.com</a> with the subject line: <strong>"Counter-Notification"</strong>. Your counter-notification must include:',
            'items' => [
                'Identification of the material that was removed or disabled and its previous location (URL or service identifier) before removal.',
                'A statement, made under penalty of perjury, that you have a good-faith belief that the material was removed or disabled as a result of mistake or misidentification.',
                'Your full legal name, physical mailing address, email address, and phone number.',
                'A statement that you consent to the jurisdiction of the federal district court for the judicial district in which your address is located (or any judicial district in which CloudHost247 Isc. may be found if you are outside the United States), and that you will accept service of process from the person who provided the original complaint or an agent of such person.',
                'Your electronic or physical signature.',
            ]
        ],
        [
            'id' => 'counter-process',
            'title' => '10. Counter-Notification Timeline',
            'content' => 'Upon receipt of a valid counter-notification, CloudHost247 Isc. will forward it to the original complainant. The complainant will then have 10 business days to seek a court order preventing restoration of the material. If no legal action is taken within that period, the material may be restored within 14 business days. Restoration is not guaranteed and may be subject to technical or account-status limitations.'
        ],
        [
            'id' => 'liability',
            'title' => '11. Limitation of Liability',
            'content' => 'CloudHost247 Isc. acts as a neutral intermediary in intellectual property disputes and does not adjudicate the merits of competing claims. We are not liable for any loss, damage, or business interruption resulting from the removal, restriction, or restoration of content pursuant to this policy. Our liability is limited to processing complaints in good faith and in accordance with the procedures described herein. We are not responsible for disputes between third parties, and we do not provide legal advice. All parties are encouraged to seek independent legal counsel.'
        ],
        [
            'id' => 'updates',
            'title' => '12. Policy Updates',
            'content' => 'CloudHost247 Isc. reserves the right to update or modify this Trademark & Copyright Infringement Policy at any time. Changes may be made to reflect updates in applicable law, ICANN regulations, or our operational procedures. Updates will be posted on this page with a revised effective date. Continued use of our services after changes constitutes acceptance of the updated policy. We encourage rights holders and customers to review this policy periodically.'
        ],
    ],
    'contact' => [
        'title' => 'Contact Information',
        'content' => 'If you have questions regarding this policy, or if you need to submit or follow up on an infringement claim, please contact our Abuse Department:',
        'email' => 'abuse@cloudhost247.com',
        'website' => 'www.cloudhost247.com',
        'portal' => 'support portal',
    ]
];

echo ch247_page([
    'title' => "Trademark & Copyright Policy | CloudHost247",
    'description' => "How CloudHost247 reviews and responds to trademark and copyright infringement claims, and how rights holders can report concerns.",
    'canonical' => 'trademark-policy.php',
    'active' => 'company',
    'crumbs' => [['index.php', 'Home'], [null, "Trademark & Copyright Policy"]],
], '<section class="section"><div class="container"><div class="card" style="padding:28px">' . ch247_policy_doc($trademarkSections) . '</div></div></section>');
