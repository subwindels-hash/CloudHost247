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

$brokerageTerms = array(
    'hero' => array(
        'title' => 'Domain Brokerage Terms',
        'subtitle' => 'Domain acquisition and brokerage service — CloudHost247',
    ),
    'sections' => array(
        array(
            'id' => 'no-guarantee',
            'title' => '1. Acquisition is not guaranteed',
            'content' => 'CloudHost247 will make commercially reasonable efforts to acquire the requested domain on your behalf through legitimate channels. We do not and cannot guarantee that any acquisition, negotiation, or transfer will succeed. A domain being registered by someone else only means it is unavailable for normal registration — it does not mean the current owner has agreed to sell it, will respond to outreach, or will accept any offer.',
        ),
        array(
            'id' => 'service-scope',
            'title' => '2. What the service includes',
            'content' => 'The Domain Brokerage service includes: researching legitimate acquisition routes for the requested domain, attempting contact with the domain owner or an authorized acquisition channel, negotiating on your behalf according to your instructions, recording offers and counteroffers, coordinating payment through your CloudHost247 account, and tracking the domain transfer until it is verified. CloudHost247 acts as an acquisition intermediary and does not itself sell domains owned by third parties.',
        ),
        array(
            'id' => 'budget',
            'title' => '3. Your maximum budget',
            'content' => 'Your maximum acquisition budget is confidential. It is never disclosed to the domain owner, a marketplace, or any provider unless you explicitly authorize that disclosure on your brokerage request. Your broker uses your budget only to guide negotiation on your behalf.',
        ),
        array(
            'id' => 'fees',
            'title' => '4. Charges are always separate',
            'content' => 'Every charge is itemized separately before you pay: (a) the domain acquisition price agreed with the owner, (b) the CloudHost247 brokerage fee, (c) any transfer fee, and (d) any payment or escrow provider fee, where an actual payment or escrow provider is used. CloudHost247 never hides fees inside the domain acquisition price. Current fee rules are published in your dashboard before a case is created.',
        ),
        array(
            'id' => 'offers-approval',
            'title' => '5. Offers, counteroffers and your approval',
            'content' => 'A seller offer or counteroffer is presented to you for review. You may accept, reject, or counter. No offer is accepted on your behalf automatically unless you have explicitly configured a documented automatic approval rule for your case. Every offer and counteroffer is recorded permanently and is never altered after the fact. Offers may carry an expiration set by the offering party; an expired offer is no longer binding.',
        ),
        array(
            'id' => 'payment',
            'title' => '6. Payment',
            'content' => 'When an agreement is reached, CloudHost247 issues an invoice to your CloudHost247 account listing every charge separately. Payment is handled by the existing CloudHost247 payment system and your chosen payment method. A transfer is only authorized after payment is confirmed. CloudHost247 does not claim that funds are held in escrow unless an actual escrow or payment provider is performing that function for your transaction.',
        ),
        array(
            'id' => 'transfer',
            'title' => '7. Transfer requirements and delivery',
            'content' => 'After agreement and payment, the domain must be transferred to CloudHost247 (or another destination you approve) and verified before the case is completed. Transfers may require an authorization (EPP) code from the current registrar, removal of a transfer lock by the current owner, and compliance with the registry and registrar policies of the relevant TLD, including any transfer waiting periods. A case is marked Completed only after the transfer has actually been verified; the domain is then associated with your CloudHost247 account through the supported registrar/domain architecture, after which you may manage the domain functions your registrar actually supports.',
        ),
        array(
            'id' => 'privacy',
            'title' => '8. Privacy and owner contact limitations',
            'content' => 'CloudHost247 contacts domain owners only through legitimate channels: public RDAP/WHOIS information where available, registrar-provided contact or forwarding mechanisms, public business contact information, the domain\'s own public website, and authorized marketplace or broker channels. Where registrant contact details are protected by a registrar privacy service, they are not exposed, and CloudHost247 does not scrape, purchase, or attempt to bypass privacy-protected registrant information. Some owners therefore cannot be reached; this is a recognized limitation of every brokerage service.',
        ),
        array(
            'id' => 'providers',
            'title' => '9. Third-party provider dependencies',
            'content' => 'Some acquisition routes depend on third-party marketplaces, brokerage providers, registrars, or payment providers. Those providers have their own terms, availability, fees, transfer policies and processing times. CloudHost247 is not responsible for the actions, availability, or refusals of third-party providers or domain owners. Where no automated provider route exists, a CloudHost247 broker may be assigned to handle your case manually; your dashboard experience is the same either way.',
        ),
        array(
            'id' => 'expiration',
            'title' => '10. Negotiation expiration and inactivity',
            'content' => 'Offers and counteroffers may expire. If you do not respond to an offer awaiting your approval within the stated period, the offer lapses and may not be repeatable on the same terms. Cases left inactive for an extended period may be closed after notice.',
        ),
        array(
            'id' => 'cancellation',
            'title' => '11. Cancellation',
            'content' => 'You may cancel your brokerage request from your dashboard at any time before an agreement is reached. Once an offer you approved has been accepted and payment has been made, cancellation is subject to the seller\'s and provider\'s terms and may no longer be possible.',
        ),
        array(
            'id' => 'refunds',
            'title' => '12. Refund rules',
            'content' => 'If no agreement is reached, you owe no acquisition price. If a case is cancelled or fails after payment, refundable amounts are returned in accordance with the case agreement, the CloudHost247 Refund Policy, and any non-refundable third-party provider, escrow or transfer fees already incurred, which are always disclosed to you. A refund is never automatic merely because a case slows down; refund outcomes follow the recorded agreement and payment provider rules.',
        ),
        array(
            'id' => 'disputes',
            'title' => '13. Disputes',
            'content' => 'If you believe something about your case is wrong, contact support promptly and we will review it. A case may be marked Disputed while it is reviewed; during a dispute, irreversible actions (such as transfer completion) are paused. Disputes are resolved case by case against the recorded offer ledger, timeline, and payment records.',
        ),
        array(
            'id' => 'responsibilities',
            'title' => '14. Your responsibilities',
            'content' => 'You agree to provide accurate contact information, to set a budget and instructions you can actually honor, to respond to offers in a timely manner, to pay agreed amounts when an agreement is reached, and to cooperate with any transfer requirements. You confirm that your intended use of the domain is lawful and does not infringe third-party rights; CloudHost247 may decline or cancel a brokerage request for a domain that appears intended for trademark abuse or fraud.',
        ),
        array(
            'id' => 'changes',
            'title' => '15. Changes to these terms',
            'content' => 'CloudHost247 may update these Domain Brokerage Terms from time to time. The version in force when a brokerage case is created governs that case unless a change is required by law. Material changes are posted to this page with an updated effective date.',
        ),
    ),
    'contact' => array(
        'title' => 'Questions',
        'content' => 'Questions about a brokerage case or these terms can be raised from your CloudHost247 dashboard or with our support team:',
        'email' => 'support@cloudhost247.com',
        'website' => 'www.cloudhost247.com',
    ),
);

echo ch247_page([
    'title' => "Domain Brokerage Service Terms | CloudHost247",
    'description' => "The terms under which CloudHost247 negotiates the acquisition of already-registered domains on your behalf.",
    'canonical' => 'domain-brokerage-terms.php',
    'active' => 'domains',
    'crumbs' => [['index.php', 'Home'], [null, "Domain Brokerage Terms"]],
], '<section class="section"><div class="container"><div class="card" style="padding:28px">' . ch247_policy_doc($brokerageTerms) . '</div></div></section>');
