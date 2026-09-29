<?php
namespace CloudHost247\Marketing\Domain;

/** Closed set of marketing email event types (requirement #23/#26). */
final class EventType
{
    const QUEUED = 'queued';
    const SENT = 'sent';                   // relay accepted — never presented as "delivered"
    const FAILED = 'failed';
    const SKIPPED = 'skipped';
    const OPENED = 'opened';               // pixel tracking event (may include client prefetch)
    const CLICKED = 'clicked';
    const UNSUBSCRIBED = 'unsubscribed';
    const BOUNCED = 'bounced';             // from real DSN/bounce evidence only
    const COMPLAINT = 'complaint';
    const TEST_SENT = 'test_sent';

    private static $labels = array(
        self::QUEUED => 'Queued',
        self::SENT => 'Accepted by relay',
        self::FAILED => 'Failed',
        self::SKIPPED => 'Skipped',
        self::OPENED => 'Tracking pixel event',
        self::CLICKED => 'Link clicked',
        self::UNSUBSCRIBED => 'Unsubscribed',
        self::BOUNCED => 'Bounced',
        self::COMPLAINT => 'Complaint',
        self::TEST_SENT => 'Test email sent',
    );

    public static function all() { return array_keys(self::$labels); }

    public static function label($type)
    {
        $type = (string) $type;
        return isset(self::$labels[$type]) ? self::$labels[$type] : 'Unknown';
    }

    public static function isValid($type) { return isset(self::$labels[(string) $type]); }
}
