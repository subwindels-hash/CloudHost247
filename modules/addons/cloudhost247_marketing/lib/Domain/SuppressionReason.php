<?php
namespace CloudHost247\Marketing\Domain;

/** Closed set of global suppression reasons (requirement #29). */
final class SuppressionReason
{
    const UNSUBSCRIBED = 'unsubscribed';
    const HARD_BOUNCE = 'hard_bounce';
    const SPAM_COMPLAINT = 'spam_complaint';
    const ADMIN_SUPPRESSED = 'admin_suppressed';
    const INVALID_ADDRESS = 'invalid_address';

    private static $labels = array(
        self::UNSUBSCRIBED => 'Unsubscribed',
        self::HARD_BOUNCE => 'Hard bounce',
        self::SPAM_COMPLAINT => 'Spam complaint',
        self::ADMIN_SUPPRESSED => 'Suppressed by administrator',
        self::INVALID_ADDRESS => 'Invalid address',
    );

    public static function all() { return array_keys(self::$labels); }

    public static function label($reason)
    {
        $reason = (string) $reason;
        return isset(self::$labels[$reason]) ? self::$labels[$reason] : 'Unknown';
    }

    public static function isValid($reason) { return isset(self::$labels[(string) $reason]); }
}
