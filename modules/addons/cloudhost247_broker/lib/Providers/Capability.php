<?php
namespace CloudHost247\Broker\Providers;

/**
 * The complete, closed set of brokerage-adjacent capabilities a provider
 * adapter may declare (see requirement #10 of the Domain Broker Service spec).
 *
 * A capability is only ever "active" for an adapter when it is genuinely
 * usable right now: the underlying integration is configured, enabled and has
 * tested Connected, and — for aftermarket capabilities that require a
 * commercial agreement — an administrator has explicitly confirmed that
 * agreement exists. The broker engine never offers an operation a provider
 * does not actually support in its current configuration.
 */
final class Capability
{
    const DOMAIN_AVAILABILITY = 'domain_availability';
    const DOMAIN_SEARCH = 'domain_search';
    const FOR_SALE_LOOKUP = 'for_sale_lookup';
    const BROKERAGE_REQUEST = 'brokerage_request';
    const OWNER_CONTACT = 'owner_contact';
    const OFFER_SUBMISSION = 'offer_submission';
    const COUNTEROFFER = 'counteroffer';
    const NEGOTIATION = 'negotiation';
    const PAYMENT = 'payment';
    const ESCROW = 'escrow';
    const TRANSFER = 'transfer';
    const TRANSFER_STATUS = 'transfer_status';
    const DOMAIN_DELIVERY = 'domain_delivery';
    const DOMAIN_REGISTRATION = 'domain_registration';
    const DNS_MANAGEMENT = 'dns_management';
    const DOMAIN_CONTACTS = 'domain_contacts';

    private static $labels = array(
        self::DOMAIN_AVAILABILITY => 'Domain availability',
        self::DOMAIN_SEARCH => 'Domain search',
        self::FOR_SALE_LOOKUP => 'For-sale lookup',
        self::BROKERAGE_REQUEST => 'Brokerage request',
        self::OWNER_CONTACT => 'Owner contact',
        self::OFFER_SUBMISSION => 'Offer submission',
        self::COUNTEROFFER => 'Counteroffer',
        self::NEGOTIATION => 'Negotiation',
        self::PAYMENT => 'Payment',
        self::ESCROW => 'Escrow',
        self::TRANSFER => 'Transfer',
        self::TRANSFER_STATUS => 'Transfer status',
        self::DOMAIN_DELIVERY => 'Domain delivery',
        self::DOMAIN_REGISTRATION => 'Domain registration',
        self::DNS_MANAGEMENT => 'DNS management',
        self::DOMAIN_CONTACTS => 'Domain contacts',
    );

    public static function all() { return array_keys(self::$labels); }

    public static function isValid($capability) { return is_string($capability) && isset(self::$labels[$capability]); }

    public static function label($capability) { return self::isValid($capability) ? self::$labels[$capability] : (string) $capability; }
}
