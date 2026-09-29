<?php
namespace CloudHost247\Marketing\Domain;

/** Closed set of subscriber states (requirement #5). */
final class SubscriberStatus
{
    const SUBSCRIBED = 'subscribed';
    const UNSUBSCRIBED = 'unsubscribed';
    const PENDING = 'pending';
    const BOUNCED = 'bounced';
    const SUPPRESSED = 'suppressed';

    private static $labels = array(
        self::SUBSCRIBED => 'Subscribed',
        self::UNSUBSCRIBED => 'Unsubscribed',
        self::PENDING => 'Pending confirmation',
        self::BOUNCED => 'Bounced',
        self::SUPPRESSED => 'Suppressed',
    );

    public static function all() { return array_keys(self::$labels); }

    public static function label($status)
    {
        $status = (string) $status;
        return isset(self::$labels[$status]) ? self::$labels[$status] : 'Unknown';
    }

    public static function isValid($status) { return isset(self::$labels[(string) $status]); }

    /** Only these statuses may ever receive a marketing campaign. */
    public static function sendableSet() { return array(self::SUBSCRIBED); }
}
