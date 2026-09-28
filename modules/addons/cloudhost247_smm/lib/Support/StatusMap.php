<?php
namespace CloudHost247\Smm\Support;

/**
 * Provider status normalization and transition policy.
 *
 * Providers spell statuses inconsistently ("In progress", "In Progress",
 * "InProgress", "Processing", "Awaiting"). Everything is folded into a fixed
 * internal vocabulary, and a verified terminal status is never silently
 * overwritten by an older or contradictory provider response — a conflict is
 * reported so a human can reconcile.
 */
final class StatusMap
{
    /** Internal vocabulary. */
    const PENDING = 'pending';
    const PROCESSING = 'processing';
    const IN_PROGRESS = 'in_progress';
    const PARTIAL = 'partial';
    const COMPLETED = 'completed';
    const CANCELED = 'canceled';
    const FAILED = 'failed';
    const REFUNDED = 'refunded';
    const UNKNOWN = 'unknown';

    /** Verified terminal statuses — never changed by a later provider response. */
    private static $terminal = array(self::COMPLETED, self::CANCELED, self::FAILED, self::REFUNDED);

    /** Raw provider spelling -> internal status. Lowercased, punctuation stripped. */
    private static $map = array(
        'pending' => self::PENDING,
        'awaiting' => self::PENDING,
        'awaiting processing' => self::PENDING,
        'queued' => self::PENDING,
        'processing' => self::PROCESSING,
        'in process' => self::PROCESSING,
        'inprogress' => self::IN_PROGRESS,
        'in progress' => self::IN_PROGRESS,
        'progress' => self::IN_PROGRESS,
        'running' => self::IN_PROGRESS,
        'active' => self::IN_PROGRESS,
        'started' => self::IN_PROGRESS,
        'partial' => self::PARTIAL,
        'partially completed' => self::PARTIAL,
        'completed' => self::COMPLETED,
        'complete' => self::COMPLETED,
        'success' => self::COMPLETED,
        'finished' => self::COMPLETED,
        'canceled' => self::CANCELED,
        'cancelled' => self::CANCELED,
        'cancel' => self::CANCELED,
        'failed' => self::FAILED,
        'error' => self::FAILED,
        'refunded' => self::REFUNDED,
        'refund' => self::REFUNDED,
        'rejected' => self::FAILED,
    );

    /**
     * Normalize a raw provider status string.
     *
     * @param string $raw
     * @return string internal status (self::UNKNOWN when unmapped)
     */
    public static function normalize($raw)
    {
        $key = strtolower(trim(preg_replace('/\s+/', ' ', (string) $raw)));
        if ($key === '') {
            return self::UNKNOWN;
        }
        $squashed = str_replace(' ', '', $key);
        if (isset(self::$map[$key])) {
            return self::$map[$key];
        }
        if (isset(self::$map[$squashed])) {
            return self::$map[$squashed];
        }
        return self::UNKNOWN;
    }

    /** @return bool true when $status is a verified terminal internal status. */
    public static function isTerminal($status)
    {
        return in_array((string) $status, self::$terminal, true);
    }

    /** @return array list of terminal internal statuses. */
    public static function terminalStatuses()
    {
        return self::$terminal;
    }

    /**
     * Decide how a newly observed provider status applies to the stored one.
     *
     * Rules:
     *  - identical status or unknown observation -> apply (timestamps refresh only)
     *  - terminal stored status + different observation -> conflict, do not overwrite
     *  - everything else -> apply the newer observation
     *
     * @param string $stored  internal status currently on the order
     * @param string $observed normalized internal status just observed
     * @return array array('apply' => string status to store, 'conflict' => bool)
     */
    public static function resolveTransition($stored, $observed)
    {
        $stored = (string) $stored;
        $observed = (string) $observed;
        if ($stored === '' || $stored === self::UNKNOWN || $observed === $stored) {
            return array('apply' => $observed === self::UNKNOWN && $stored === '' ? self::UNKNOWN : ($observed === self::UNKNOWN ? $stored : $observed), 'conflict' => false);
        }
        if (self::isTerminal($stored) && $observed !== $stored) {
            return array('apply' => $stored, 'conflict' => true);
        }
        return array('apply' => $observed, 'conflict' => false);
    }

    /** All internal statuses, for filters and tables. */
    public static function allStatuses()
    {
        return array(
            self::PENDING, self::PROCESSING, self::IN_PROGRESS, self::PARTIAL,
            self::COMPLETED, self::CANCELED, self::FAILED, self::REFUNDED, self::UNKNOWN,
        );
    }

    /** Safe customer-facing label for an internal status. */
    public static function customerLabel($status)
    {
        $labels = array(
            self::PENDING => 'Pending',
            self::PROCESSING => 'Processing',
            self::IN_PROGRESS => 'In progress',
            self::PARTIAL => 'Partially completed',
            self::COMPLETED => 'Completed',
            self::CANCELED => 'Canceled',
            self::FAILED => 'Failed',
            self::REFUNDED => 'Refunded',
            self::UNKNOWN => 'Not verified',
        );
        $status = (string) $status;
        return isset($labels[$status]) ? $labels[$status] : 'Not verified';
    }
}
