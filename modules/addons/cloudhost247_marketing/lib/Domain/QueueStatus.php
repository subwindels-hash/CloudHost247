<?php
namespace CloudHost247\Marketing\Domain;

/** Closed set of per-message queue states (requirement #23). */
final class QueueStatus
{
    const QUEUED = 'queued';     // waiting for a worker claim
    const SENDING = 'sending';   // locked by a worker, send in flight
    const SENT = 'sent';         // SMTP relay accepted the message (NOT confirmed delivery)
    const FAILED = 'failed';     // permanent failure after retries; details in last_error_*
    const SKIPPED = 'skipped';   // excluded before send (suppressed/unsubscribed/duplicate/cancelled)

    private static $labels = array(
        self::QUEUED => 'Queued',
        self::SENDING => 'Sending (locked)',
        self::SENT => 'Accepted by relay',
        self::FAILED => 'Failed',
        self::SKIPPED => 'Skipped',
    );

    public static function all() { return array_keys(self::$labels); }

    public static function label($status)
    {
        $status = (string) $status;
        return isset(self::$labels[$status]) ? self::$labels[$status] : 'Unknown';
    }

    public static function isValid($status) { return isset(self::$labels[(string) $status]); }
}
