<?php
namespace CloudHost247\Broker\Domain;

/**
 * The complete, closed set of domain states the broker service will ever
 * report to a customer or an administrator. A domain being REGISTERED never
 * implies the owner has agreed to sell it — that distinction is enforced
 * everywhere this constant is used (see docs/independent-rebuild/DOMAIN-BROKER.md).
 */
final class DomainState
{
    const AVAILABLE = 'available';
    const REGISTERED = 'registered';
    const UNAVAILABLE = 'unavailable';
    const PREMIUM = 'premium';
    const RESERVED = 'reserved';
    const TRANSFER_RESTRICTED = 'transfer_restricted';
    const UNKNOWN = 'unknown';
    const PROVIDER_UNAVAILABLE = 'provider_unavailable';

    private static $labels = array(
        self::AVAILABLE => 'Available for registration',
        self::REGISTERED => 'Already registered',
        self::UNAVAILABLE => 'Unavailable',
        self::PREMIUM => 'Premium domain',
        self::RESERVED => 'Reserved',
        self::TRANSFER_RESTRICTED => 'Registered (transfer restricted)',
        self::UNKNOWN => 'Unknown',
        self::PROVIDER_UNAVAILABLE => 'Domain provider temporarily unavailable',
    );

    /** States for which brokerage acquisition can legitimately be offered. */
    private static $brokerable = array(
        self::REGISTERED, self::UNAVAILABLE, self::PREMIUM, self::RESERVED, self::TRANSFER_RESTRICTED,
    );

    public static function all() { return array_keys(self::$labels); }

    public static function isValid($state) { return is_string($state) && isset(self::$labels[$state]); }

    public static function label($state) { return self::isValid($state) ? self::$labels[$state] : self::$labels[self::UNKNOWN]; }

    /** True when it is legitimate to show "Broker This Domain" for this state. */
    public static function isBrokerEligible($state)
    {
        return in_array($state, self::$brokerable, true);
    }
}
