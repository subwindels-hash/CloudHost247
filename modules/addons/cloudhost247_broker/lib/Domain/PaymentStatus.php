<?php
namespace CloudHost247\Broker\Domain;

/** Real payment states (requirement #23) — no fabricated "escrow" state exists here. */
final class PaymentStatus
{
    const PENDING = 'pending';
    const INITIATED = 'initiated';
    const AUTHORIZED = 'authorized';
    const PAID = 'paid';
    const FAILED = 'failed';
    const REFUNDED = 'refunded';
    const CANCELLED = 'cancelled';

    private static $labels = array(
        self::PENDING => 'Pending', self::INITIATED => 'Initiated', self::AUTHORIZED => 'Authorized',
        self::PAID => 'Paid', self::FAILED => 'Failed', self::REFUNDED => 'Refunded', self::CANCELLED => 'Cancelled',
    );

    public static function all() { return array_keys(self::$labels); }
    public static function isValid($s) { return is_string($s) && isset(self::$labels[$s]); }
    public static function label($s) { return self::isValid($s) ? self::$labels[$s] : (string) $s; }
}
