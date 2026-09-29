<?php
namespace CloudHost247\Broker\Domain;

/** Real transfer states (requirement #24). A case is never marked completed before VERIFIED. */
final class TransferStatus
{
    const NOT_STARTED = 'not_started';
    const AUTHORIZATION_PENDING = 'authorization_pending';
    const AUTHORIZED = 'authorized';
    const INITIATED = 'initiated';
    const PROVIDER_CONFIRMED = 'provider_confirmed';
    const PROCESSING = 'processing';
    const VERIFIED = 'verified';
    const COMPLETED = 'completed';
    const FAILED = 'failed';

    private static $labels = array(
        self::NOT_STARTED => 'Not started', self::AUTHORIZATION_PENDING => 'Transfer authorization pending',
        self::AUTHORIZED => 'Transfer authorized', self::INITIATED => 'Transfer initiated',
        self::PROVIDER_CONFIRMED => 'Provider confirmation received', self::PROCESSING => 'Transfer processing',
        self::VERIFIED => 'Transfer verified', self::COMPLETED => 'Completed', self::FAILED => 'Failed',
    );

    private static $order = array(
        self::NOT_STARTED, self::AUTHORIZATION_PENDING, self::AUTHORIZED, self::INITIATED,
        self::PROVIDER_CONFIRMED, self::PROCESSING, self::VERIFIED, self::COMPLETED,
    );

    public static function all() { return array_keys(self::$labels); }
    public static function isValid($s) { return is_string($s) && isset(self::$labels[$s]); }
    public static function label($s) { return self::isValid($s) ? self::$labels[$s] : (string) $s; }

    public static function canAdvance($from, $to)
    {
        if ($to === self::FAILED) { return $from !== self::COMPLETED; }
        $fromIndex = array_search($from, self::$order, true);
        $toIndex = array_search($to, self::$order, true);
        return $fromIndex !== false && $toIndex !== false && $toIndex === $fromIndex + 1;
    }
}
