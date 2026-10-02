<?php
namespace CloudHost247\NetworkTools\Core\Result;

/**
 * Tool status vocabulary (docs section 72). The front end renders exactly the
 * stored state — a tool that cannot run never shows a successful result.
 */
final class ToolStatus
{
    const ACTIVE = 'ACTIVE';
    const DISABLED = 'DISABLED';
    const MAINTENANCE = 'MAINTENANCE';
    const CONFIGURATION_REQUIRED = 'CONFIGURATION_REQUIRED';
    const SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE';

    public static function all()
    {
        return array(self::ACTIVE, self::DISABLED, self::MAINTENANCE, self::CONFIGURATION_REQUIRED, self::SERVICE_UNAVAILABLE);
    }

    public static function isValid($status)
    {
        return in_array((string) $status, self::all(), true);
    }

    /** A status the operator can switch to by hand (the others are computed). */
    public static function isOperatorState($status)
    {
        return in_array((string) $status, array(self::ACTIVE, self::DISABLED, self::MAINTENANCE), true);
    }

    public static function label($status)
    {
        $labels = array(
            self::ACTIVE => 'Active',
            self::DISABLED => 'Disabled',
            self::MAINTENANCE => 'Maintenance',
            self::CONFIGURATION_REQUIRED => 'Configuration required',
            self::SERVICE_UNAVAILABLE => 'Service unavailable',
        );
        return isset($labels[$status]) ? $labels[$status] : 'Unknown';
    }

    public static function tone($status)
    {
        $tones = array(
            self::ACTIVE => 'ok',
            self::DISABLED => 'muted',
            self::MAINTENANCE => 'warn',
            self::CONFIGURATION_REQUIRED => 'warn',
            self::SERVICE_UNAVAILABLE => 'error',
        );
        return isset($tones[$status]) ? $tones[$status] : 'muted';
    }
}
