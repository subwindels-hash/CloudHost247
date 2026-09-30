<?php
/**
 * Single source of truth for this addon's table names. Keeping them here
 * avoids the string duplication that makes schema changes risky.
 */

namespace CloudHost247\CartRecovery;

final class Schema
{
    const RECOVERIES = 'mod_cloudhost247_cart_recovery_recoveries';
    const REMINDER_LOGS = 'mod_cloudhost247_cart_recovery_reminder_logs';
    const SUPPRESSIONS = 'mod_cloudhost247_cart_recovery_suppressions';
    const SETTINGS = 'mod_cloudhost247_cart_recovery_settings';
    const MIGRATIONS = 'mod_cloudhost247_cart_recovery_migrations';

    /** Lifecycle states. The state machine is explicit and terminal states never receive reminders. */
    const STATUS_ACTIVE = 'active';
    const STATUS_ABANDONED = 'abandoned';
    const STATUS_RECOVERED = 'recovered';
    const STATUS_CONVERTED = 'converted';
    const STATUS_EXPIRED = 'expired';
    const STATUS_CLOSED = 'closed';
    const STATUS_UNSUBSCRIBED = 'unsubscribed';

    /** States that may still be updated by cart activity or receive reminders. */
    public static function openStatuses()
    {
        return array(self::STATUS_ACTIVE, self::STATUS_ABANDONED, self::STATUS_RECOVERED);
    }

    /** States that must never receive another reminder. */
    public static function terminalStatuses()
    {
        return array(self::STATUS_CONVERTED, self::STATUS_EXPIRED, self::STATUS_CLOSED, self::STATUS_UNSUBSCRIBED);
    }

    public static function allStatuses()
    {
        return array_merge(self::openStatuses(), self::terminalStatuses());
    }

    /** Reminder log states. */
    public static function reminderStatuses()
    {
        return array('pending', 'sending', 'sent', 'failed', 'skipped');
    }
}
