<?php
namespace CloudHost247\Marketing\Domain;

/**
 * Closed set of automation states. An automation is only ever in one of these,
 * and only `active` enrols or advances anybody.
 */
final class AutomationStatus
{
    const DRAFT = 'draft';
    const ACTIVE = 'active';
    const PAUSED = 'paused';
    const ARCHIVED = 'archived';

    private static $labels = array(
        self::DRAFT => 'Draft',
        self::ACTIVE => 'Active',
        self::PAUSED => 'Paused',
        self::ARCHIVED => 'Archived',
    );

    public static function all() { return array_keys(self::$labels); }
    public static function isValid($status) { return isset(self::$labels[(string) $status]); }
    public static function label($status)
    {
        $status = (string) $status;
        return isset(self::$labels[$status]) ? self::$labels[$status] : 'Unknown';
    }
    public static function isEnrolling($status) { return (string) $status === self::ACTIVE; }
}
