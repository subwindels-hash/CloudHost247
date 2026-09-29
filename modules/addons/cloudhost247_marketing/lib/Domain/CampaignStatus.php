<?php
namespace CloudHost247\Marketing\Domain;

/**
 * Closed set of campaign states (requirement #13). A campaign never holds a
 * state outside this list, and the UI only ever renders these labels.
 */
final class CampaignStatus
{
    const DRAFT = 'draft';
    const READY = 'ready';
    const SCHEDULED = 'scheduled';
    const QUEUED = 'queued';
    const SENDING = 'sending';
    const PAUSED = 'paused';
    const COMPLETED = 'completed';
    const CANCELLED = 'cancelled';
    const FAILED = 'failed';
    const ARCHIVED = 'archived';

    private static $labels = array(
        self::DRAFT => 'Draft',
        self::READY => 'Ready to send',
        self::SCHEDULED => 'Scheduled',
        self::QUEUED => 'Queued',
        self::SENDING => 'Sending',
        self::PAUSED => 'Paused',
        self::COMPLETED => 'Completed',
        self::CANCELLED => 'Cancelled',
        self::FAILED => 'Failed',
        self::ARCHIVED => 'Archived',
    );

    public static function all() { return array_keys(self::$labels); }

    public static function label($status)
    {
        $status = (string) $status;
        return isset(self::$labels[$status]) ? self::$labels[$status] : 'Unknown';
    }

    public static function isValid($status) { return isset(self::$labels[(string) $status]); }

    /** States that the delivery engine is allowed to advance. */
    public static function activeSet()
    {
        return array(self::QUEUED, self::SENDING, self::PAUSED, self::SCHEDULED);
    }

    /** States from which no further sending is ever possible. */
    public static function terminalSet()
    {
        return array(self::COMPLETED, self::CANCELLED, self::FAILED, self::ARCHIVED);
    }

    public static function isTerminal($status)
    {
        return in_array((string) $status, self::terminalSet(), true);
    }
}
