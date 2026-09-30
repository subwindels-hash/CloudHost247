<?php
/**
 * Reminder scheduling and delivery engine.
 *
 * Idempotency model: the reminder log has a UNIQUE (recovery_id,
 * reminder_number) key. A reminder is only sent by the process that manages
 * to move that row from pending/failed to "sending" with a conditional
 * UPDATE, so duplicate cron runs, overlapping workers, crashes and manual
 * admin triggers cannot produce a duplicate email.
 */

namespace CloudHost247\CartRecovery;

use WHMCS\Database\Capsule;

final class ReminderService
{
    /**
     * Process one batch of due reminders.
     *
     * @return array counters for the run
     */
    public static function process($limit = null)
    {
        $result = array('marked_abandoned' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0, 'expired' => 0, 'processed' => 0);
        if (!SettingsRepository::enabled('enabled')) {
            $result['disabled'] = true;
            return $result;
        }
        $limit = $limit === null ? SettingsRepository::int('batch_size') : (int) $limit;
        $limit = max(1, min(500, $limit));

        $result['marked_abandoned'] = RecoveryService::markAbandoned($limit);

        $now = RecoveryService::now();
        $rows = RecoveryService::table()
            ->where('status', Schema::STATUS_ABANDONED)
            ->whereNotNull('next_reminder_at')
            ->where('next_reminder_at', '<=', $now)
            ->orderBy('next_reminder_at')
            ->limit($limit)
            ->get();

        foreach ($rows as $row) {
            $result['processed']++;
            $outcome = self::processRecord($row);
            if (isset($result[$outcome])) {
                $result[$outcome]++;
            } else {
                $result['skipped']++;
            }
        }

        $result['expired'] = RecoveryService::expireStale($limit * 2);
        return $result;
    }

    /**
     * Evaluate and, when every condition holds, send the next reminder for a
     * single record.
     *
     * @return string sent|failed|skipped|expired
     */
    public static function processRecord($row)
    {
        // 1. The record must still exist and still be abandoned.
        $fresh = RecoveryService::find(isset($row->id) ? $row->id : 0);
        if (!$fresh || $fresh->status !== Schema::STATUS_ABANDONED) {
            return 'skipped';
        }
        // 2. The recovery token must still be valid.
        if (strtotime((string) $fresh->token_expires_at) <= time()) {
            RecoveryService::expire((int) $fresh->id);
            return 'expired';
        }
        // 3. The cart must not be empty.
        if (CartSnapshot::isEmpty(CartSnapshot::restore($fresh->cart_snapshot))) {
            RecoveryService::close((int) $fresh->id, 'cart_emptied');
            return 'skipped';
        }
        // 4. The address must be usable.
        $email = RecoveryService::normaliseEmail($fresh->email);
        if ($email === '') {
            self::logReminder($fresh, max(1, (int) $fresh->last_reminder_number + 1), 'skipped', 'No valid email address on the recovery record');
            RecoveryService::table()->where('id', $fresh->id)->update(array('next_reminder_at' => null, 'updated_at' => RecoveryService::now()));
            return 'skipped';
        }
        // 5. Suppression / unsubscribe must be respected.
        if (RecoveryService::isSuppressed($email, (int) $fresh->client_id)) {
            RecoveryService::transition((int) $fresh->id, Schema::STATUS_UNSUBSCRIBED, array('next_reminder_at' => null, 'unsubscribed_at' => RecoveryService::now()));
            return 'skipped';
        }
        // 6. The client, when known, must still exist and be usable.
        if ($fresh->client_id && !self::clientIsActive((int) $fresh->client_id)) {
            RecoveryService::close((int) $fresh->id, 'client_unavailable');
            return 'skipped';
        }
        // 7. A reminder must actually be configured and due.
        $number = RecoveryService::nextReminderNumber((int) $fresh->last_reminder_number);
        if ($number < 1) {
            RecoveryService::table()->where('id', $fresh->id)->update(array('next_reminder_at' => null, 'updated_at' => RecoveryService::now()));
            return 'skipped';
        }
        $due = RecoveryService::scheduleFor($fresh->abandoned_at, (int) $fresh->last_reminder_number);
        if ($due !== null && strtotime($due) > time() && !self::isRetryDue($fresh, $number)) {
            return 'skipped';
        }

        return self::deliver($fresh, $number);
    }

    /**
     * Claim the (recovery, reminder) slot and send. Returns sent|failed|skipped.
     */
    public static function deliver($recovery, $number)
    {
        $now = RecoveryService::now();
        $logs = Capsule::table(Schema::REMINDER_LOGS);
        $existing = $logs->where('recovery_id', (int) $recovery->id)->where('reminder_number', (int) $number)->first();

        if ($existing && in_array($existing->status, array('sent', 'sending'), true)) {
            // Already sent, or another worker is sending it right now.
            return 'skipped';
        }
        $attempts = $existing && isset($existing->attempts) ? (int) $existing->attempts : 0;
        $maxRetries = max(1, SettingsRepository::int('max_retries'));
        if ($attempts >= $maxRetries) {
            self::advance($recovery, $number, $now);
            return 'skipped';
        }

        if (!$existing) {
            try {
                Capsule::table(Schema::REMINDER_LOGS)->insert(array(
                    'recovery_id' => (int) $recovery->id,
                    'reminder_number' => (int) $number,
                    'email' => (string) $recovery->email,
                    'template_name' => EmailService::templateName($number),
                    'status' => 'pending',
                    'attempts' => 0,
                    'created_at' => $now,
                    'updated_at' => $now,
                ));
            } catch (\Throwable $e) {
                // The UNIQUE key rejected the insert: another worker owns it.
                return 'skipped';
            }
        }

        // Atomic claim — exactly one process can move pending/failed to sending.
        $claimed = Capsule::table(Schema::REMINDER_LOGS)
            ->where('recovery_id', (int) $recovery->id)
            ->where('reminder_number', (int) $number)
            ->whereIn('status', array('pending', 'failed'))
            ->update(array('status' => 'sending', 'attempts' => $attempts + 1, 'updated_at' => $now));
        if (!$claimed) {
            return 'skipped';
        }

        try {
            $rawToken = TokenService::open($recovery->token_ciphertext);
            if (!TokenService::valid($rawToken) || !TokenService::equals(TokenService::hash($rawToken), (string) $recovery->token_hash)) {
                throw new \RuntimeException('Stored recovery token could not be verified');
            }
            EmailService::sendReminder($recovery, $number, $rawToken);
            Capsule::table(Schema::REMINDER_LOGS)
                ->where('recovery_id', (int) $recovery->id)
                ->where('reminder_number', (int) $number)
                ->update(array('status' => 'sent', 'sent_at' => $now, 'error_message' => null, 'updated_at' => $now));
            self::advance($recovery, $number, $now, true);
            Log::info('reminder.sent', array('recovery_id' => (int) $recovery->id, 'reminder_number' => (int) $number));
            return 'sent';
        } catch (\Throwable $e) {
            $safe = Log::safeError($e);
            Capsule::table(Schema::REMINDER_LOGS)
                ->where('recovery_id', (int) $recovery->id)
                ->where('reminder_number', (int) $number)
                ->update(array('status' => 'failed', 'failed_at' => $now, 'error_message' => $safe, 'updated_at' => $now));
            // Controlled retry: never a tight loop.
            RecoveryService::table()->where('id', (int) $recovery->id)->update(array(
                'next_reminder_at' => date('Y-m-d H:i:s', time() + max(300, SettingsRepository::int('retry_delay'))),
                'updated_at' => $now,
            ));
            Log::error('reminder.failed', array('recovery_id' => (int) $recovery->id, 'reminder_number' => (int) $number, 'error' => $safe));
            return 'failed';
        }
    }

    /** Record the sent reminder on the recovery row and schedule the next one. */
    private static function advance($recovery, $number, $now, $sent = false)
    {
        $update = array(
            'next_reminder_at' => RecoveryService::scheduleFor($recovery->abandoned_at, (int) $number),
            'last_reminder_number' => (int) $number,
            'updated_at' => $now,
        );
        if ($sent) {
            $update['last_reminder_at'] = $now;
        }
        RecoveryService::table()->where('id', (int) $recovery->id)->update($update);
        if ($update['next_reminder_at'] !== null) {
            Log::info('reminder.scheduled', array('recovery_id' => (int) $recovery->id, 'reminder_number' => (int) $number + 1, 'due' => $update['next_reminder_at']));
        }
    }

    /** True when a previously failed attempt is ready to be retried. */
    private static function isRetryDue($recovery, $number)
    {
        $log = Capsule::table(Schema::REMINDER_LOGS)
            ->where('recovery_id', (int) $recovery->id)
            ->where('reminder_number', (int) $number)
            ->first();
        if (!$log || $log->status !== 'failed') {
            return false;
        }
        $failedAt = strtotime((string) $log->failed_at);
        return $failedAt !== false && ($failedAt + max(300, SettingsRepository::int('retry_delay'))) <= time();
    }

    /** Explicit admin retry of a failed reminder; same rules as cron. */
    public static function retry($recoveryId, $number)
    {
        $recovery = RecoveryService::find($recoveryId);
        if (!$recovery || $recovery->status !== Schema::STATUS_ABANDONED) {
            return 'skipped';
        }
        $log = Capsule::table(Schema::REMINDER_LOGS)
            ->where('recovery_id', (int) $recoveryId)
            ->where('reminder_number', (int) $number)
            ->first();
        if (!$log || $log->status !== 'failed') {
            return 'skipped';
        }
        // Reset the attempt budget by one so an administrator can retry a
        // reminder that exhausted automatic retries, but never unlimited
        // duplicate sends: 'sent' rows are still refused above.
        if (isset($log->attempts) && (int) $log->attempts >= max(1, SettingsRepository::int('max_retries'))) {
            Capsule::table(Schema::REMINDER_LOGS)->where('id', $log->id)->update(array(
                'attempts' => max(0, max(1, SettingsRepository::int('max_retries')) - 1),
                'updated_at' => RecoveryService::now(),
            ));
        }
        return self::deliver($recovery, (int) $number);
    }

    /**
     * Send the next due reminder for one record on admin request. Uses the
     * same validation path as cron, so no duplicate can be produced.
     */
    public static function sendNow($recoveryId)
    {
        $recovery = RecoveryService::find($recoveryId);
        if (!$recovery) {
            return 'skipped';
        }
        return self::processRecord($recovery);
    }

    /** Reminder history for one record, ordered by reminder number. */
    public static function history($recoveryId)
    {
        $rows = Capsule::table(Schema::REMINDER_LOGS)
            ->where('recovery_id', (int) $recoveryId)
            ->orderBy('reminder_number')
            ->get();
        $history = array();
        foreach ($rows as $row) {
            $history[(int) $row->reminder_number] = $row;
        }
        return $history;
    }

    private static function logReminder($recovery, $number, $status, $message)
    {
        $now = RecoveryService::now();
        try {
            Capsule::table(Schema::REMINDER_LOGS)->updateOrInsert(
                array('recovery_id' => (int) $recovery->id, 'reminder_number' => (int) $number),
                array(
                    'email' => (string) $recovery->email,
                    'template_name' => EmailService::templateName($number),
                    'status' => $status,
                    'error_message' => substr((string) $message, 0, 500),
                    'created_at' => $now,
                    'updated_at' => $now,
                )
            );
        } catch (\Throwable $e) {
            Log::error('reminder.log_failed', array('recovery_id' => (int) $recovery->id, 'error' => Log::safeError($e)));
        }
    }

    /** A closed or deleted WHMCS client must not receive reminders. */
    private static function clientIsActive($clientId)
    {
        try {
            $client = Capsule::table('tblclients')->where('id', (int) $clientId)->first();
            if (!$client) {
                return false;
            }
            if (isset($client->status) && strtolower((string) $client->status) === 'closed') {
                return false;
            }
            return true;
        } catch (\Throwable $e) {
            // If the lookup itself fails, do not block delivery decisions on it.
            return true;
        }
    }
}
