<?php
namespace CloudHost247\Marketing\Domain;

/**
 * Closed set of automation triggers:
 *  * subscriber_added — any new subscriber (whatever brought them in);
 *  * list_joined — a subscriber joins the automation\'s own list;
 *  * manual — only the operator (or an API call) enrols anybody.
 */
final class AutomationTrigger
{
    const SUBSCRIBER_ADDED = 'subscriber_added';
    const LIST_JOINED = 'list_joined';
    const MANUAL = 'manual';

    private static $labels = array(
        self::SUBSCRIBER_ADDED => 'When a subscriber is added',
        self::LIST_JOINED => 'When somebody joins a list',
        self::MANUAL => 'Only when enrolled by hand',
    );

    public static function all() { return array_keys(self::$labels); }
    public static function isValid($type) { return isset(self::$labels[(string) $type]); }
    public static function label($type)
    {
        $type = (string) $type;
        return isset(self::$labels[$type]) ? self::$labels[$type] : 'Unknown';
    }
    public static function requiresList($type) { return (string) $type === self::LIST_JOINED; }
}
