<?php
namespace CloudHost247\Marketing\Domain;

/**
 * Closed set of run states. A run is `waiting` whenever its next step is in the
 * future, `running` when it is due, and terminal in the other three.
 */
final class AutomationRunStatus
{
    const RUNNING = 'running';
    const WAITING = 'waiting';
    const COMPLETED = 'completed';
    const CANCELLED = 'cancelled';
    const FAILED = 'failed';

    private static $labels = array(
        self::RUNNING => 'Running',
        self::WAITING => 'Waiting',
        self::COMPLETED => 'Completed',
        self::CANCELLED => 'Cancelled',
        self::FAILED => 'Failed',
    );

    public static function all() { return array_keys(self::$labels); }
    public static function isValid($status) { return isset(self::$labels[(string) $status]); }
    public static function label($status)
    {
        $status = (string) $status;
        return isset(self::$labels[$status]) ? self::$labels[$status] : 'Unknown';
    }
    public static function isTerminal($status)
    {
        return in_array((string) $status, array(self::COMPLETED, self::CANCELLED, self::FAILED), true);
    }
}
