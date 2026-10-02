<?php
namespace CloudHost247\Marketing\Domain;

/**
 * Closed set of automation step types. A journey is a list of these, and the
 * engine only knows the two — anything else is refused at save time rather than
 * silently skipped at run time.
 */
final class AutomationStepType
{
    const WAIT = 'wait';
    const SEND_EMAIL = 'send_email';

    private static $labels = array(
        self::WAIT => 'Wait',
        self::SEND_EMAIL => 'Send email',
    );

    public static function all() { return array_keys(self::$labels); }
    public static function isValid($type) { return isset(self::$labels[(string) $type]); }
    public static function label($type)
    {
        $type = (string) $type;
        return isset(self::$labels[$type]) ? self::$labels[$type] : 'Unknown';
    }
    public static function isSending($type) { return (string) $type === self::SEND_EMAIL; }
}
