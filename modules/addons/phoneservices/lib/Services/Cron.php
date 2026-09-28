<?php
/**
 * Scheduled work: renewals, expiries, provider reconciliation and retention.
 *
 * Invoked from the WHMCS cron hooks (hooks.php) and from the standalone CLI
 * runner (cron/run.php) so operators can schedule it independently.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Services;

use PhoneServices\Core\Config;
use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;

class Cron
{
    /**
     * Daily maintenance run.
     *
     * @return array<string,int>
     */
    public function runDaily(): array
    {
        $summary = [
            'numbers_renewed'    => 0,
            'renewal_reminders'  => 0,
            'esims_expired'      => 0,
            'esim_reminders'     => 0,
            'data_synced'        => 0,
            'usage_pruned'       => 0,
            'logs_pruned'        => 0,
            'tokens_pruned'      => 0,
        ];

        $summary['numbers_renewed'] = $this->processNumberRenewals($summary);
        $summary['esims_expired'] = $this->processEsimLifecycle($summary);
        $summary['data_synced'] = $this->syncEsimUsage();

        $usageService = new UsageService();
        $summary['usage_pruned'] = $usageService->cleanupOldUsage();
        $summary['logs_pruned'] = Logger::cleanOldLogs();
        $summary['tokens_pruned'] = $this->pruneExpiredTokens();

        $usageService->generateDailyReport();

        return $summary;
    }

    /**
     * Frequent run: reconcile in-flight calls and messages with the provider.
     *
     * @return array<string,int>
     */
    public function runFrequent(): array
    {
        $summary = ['calls_reconciled' => 0, 'messages_reconciled' => 0];

        $voipService = new VoipService();
        $smsService = new SmsService();

        // Calls still marked live after 4 hours are certainly finished.
        $staleCalls = Database::raw(
            'SELECT * FROM mod_phoneservices_calls
              WHERE status IN (?, ?)
                AND started_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
              ORDER BY id DESC LIMIT 100',
            ['ringing', 'connected']
        );

        foreach ($staleCalls as $call) {
            $details = $voipService->getCallDetails((string) $call['call_id']);

            if (!empty($details['status'])) {
                $voipService->updateCallStatus((string) $call['call_id'], (string) $details['status'], $details);
                $summary['calls_reconciled']++;
            } elseif (strtotime((string) $call['started_at']) < time() - 14400) {
                $voipService->updateCallStatus((string) $call['call_id'], 'ended', []);
                $summary['calls_reconciled']++;
            }
        }

        // Messages stuck in queued/sent for more than 15 minutes.
        $staleMessages = Database::raw(
            'SELECT * FROM mod_phoneservices_messages
              WHERE status IN (?, ?)
                AND channel = ?
                AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)
                AND created_at > DATE_SUB(NOW(), INTERVAL 2 DAY)
              ORDER BY id DESC LIMIT 100',
            ['queued', 'sent', 'sms']
        );

        foreach ($staleMessages as $message) {
            if (empty($message['message_id'])) {
                continue;
            }

            $status = $smsService->getMessageStatus((string) $message['message_id']);

            if (!empty($status['status']) && $status['status'] !== $message['status']) {
                Database::update('mod_phoneservices_messages', [
                    'status'       => (string) $status['status'],
                    'delivered_at' => $status['status'] === 'delivered' ? date('Y-m-d H:i:s') : null,
                ], ['id' => (int) $message['id']]);
                $summary['messages_reconciled']++;
            }
        }

        return $summary;
    }

    /**
     * Auto-renew numbers that are due, or flag them for the client.
     *
     * @param array<string,int> $summary
     */
    private function processNumberRenewals(array &$summary): int
    {
        $numberService = new NumberService();
        $renewed = 0;

        foreach ($numberService->getRenewalDueNumbers(3) as $number) {
            $dueAt = strtotime((string) $number['next_renewal']);

            if ($dueAt !== false && $dueAt <= time()) {
                $result = $numberService->renewNumber((int) $number['id']);
                if (!empty($result['success'])) {
                    $renewed++;
                } else {
                    Logger::warning('Number renewal failed', [
                        'number' => $number['id'],
                        'error'  => $result['error'] ?? 'unknown',
                    ]);
                }
                continue;
            }

            Logger::info('Number renewal due shortly', [
                'number' => $number['id'],
                'user'   => $number['user_id'],
                'due'    => $number['next_renewal'],
            ]);
            $summary['renewal_reminders']++;
        }

        return $renewed;
    }

    /**
     * Expire eSIM plans past their end date, warn on those close to it.
     *
     * @param array<string,int> $summary
     */
    private function processEsimLifecycle(array &$summary): int
    {
        $esimService = new EsimService();
        $expired = 0;

        foreach ($esimService->getExpiringEsims(3) as $esim) {
            $expiresAt = strtotime((string) $esim['expires_at']);

            if ($expiresAt !== false && $expiresAt <= time()) {
                if ($esimService->expireEsim((int) $esim['id'])) {
                    $expired++;
                }
                continue;
            }

            Logger::info('eSIM expiring soon', [
                'esim'    => $esim['id'],
                'user'    => $esim['user_id'],
                'expires' => $esim['expires_at'],
            ]);
            $summary['esim_reminders']++;
        }

        return $expired;
    }

    /**
     * Pull fresh data-usage counters for active eSIMs.
     */
    private function syncEsimUsage(): int
    {
        if (!Config::isServiceEnabled('esim')) {
            return 0;
        }

        $esimService = new EsimService();
        $synced = 0;

        $active = Database::select('mod_phoneservices_esims', '*', ['status' => 'active'], 'updated_at', 'ASC', 200);

        foreach ($active as $esim) {
            $usage = $esimService->checkUsage((int) $esim['id']);
            if (empty($usage['error'])) {
                $synced++;
            }
        }

        return $synced;
    }

    /**
     * Remove expired WebRTC tokens and consumed OTP codes.
     */
    private function pruneExpiredTokens(): int
    {
        $removed = Database::statement(
            'DELETE FROM mod_phoneservices_webrtc_tokens WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)'
        );

        $removed += Database::statement(
            'DELETE FROM mod_phoneservices_otp WHERE expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
        );

        return $removed;
    }
}
