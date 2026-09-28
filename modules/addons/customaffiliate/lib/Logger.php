<?php
/**
 * Audit logging.
 *
 * Every decision the commission engine makes - including the skips - is written
 * to mod_customaffiliate_log so an operator can always answer "why did (or
 * didn't) this affiliate get paid?".
 *
 * Logging must never break a payment flow: all writes are guarded, and a failed
 * write degrades to the PHP error log.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class Logger
{
    const TABLE = 'mod_customaffiliate_log';

    const LEVEL_DEBUG   = 'debug';
    const LEVEL_INFO    = 'info';
    const LEVEL_WARNING = 'warning';
    const LEVEL_ERROR   = 'error';

    /** @var bool Guards against recursion when the log write itself fails. */
    private static $writing = false;

    /**
     * @param array<string,mixed> $context
     */
    public static function debug(string $message, array $context = []): void
    {
        if (!Settings::debugLogging()) {
            return;
        }

        self::write(self::LEVEL_DEBUG, 'debug', $message, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    public static function info(string $message, array $context = []): void
    {
        self::write(self::LEVEL_INFO, (string) ($context['action'] ?? 'info'), $message, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    public static function warning(string $message, array $context = []): void
    {
        self::write(self::LEVEL_WARNING, (string) ($context['action'] ?? 'warning'), $message, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    public static function error(string $message, array $context = []): void
    {
        self::write(self::LEVEL_ERROR, (string) ($context['action'] ?? 'error'), $message, $context);
    }

    /**
     * Record a commission decision (payout, reversal or skip).
     *
     * @param array<string,mixed> $context
     */
    public static function commission(string $action, string $message, array $context = []): void
    {
        $level = ($context['level'] ?? self::LEVEL_INFO);

        self::write((string) $level, $action, $message, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    private static function write(string $level, string $action, string $message, array $context): void
    {
        if (self::$writing) {
            error_log('[customaffiliate][' . $level . '] ' . $message);

            return;
        }

        self::$writing = true;

        try {
            Capsule::table(self::TABLE)->insert([
                'level'        => in_array($level, [self::LEVEL_DEBUG, self::LEVEL_INFO, self::LEVEL_WARNING, self::LEVEL_ERROR], true)
                    ? $level
                    : self::LEVEL_INFO,
                'service_id'   => isset($context['service_id']) ? (int) $context['service_id'] : null,
                'affiliate_id' => isset($context['affiliate_id']) ? (int) $context['affiliate_id'] : null,
                'invoice_id'   => isset($context['invoice_id']) ? (int) $context['invoice_id'] : null,
                'action'       => substr($action, 0, 50),
                'amount'       => isset($context['amount']) ? round((float) $context['amount'], 2) : 0.00,
                'percentage'   => isset($context['rate']) ? round((float) $context['rate'], 3) : 0.000,
                'description'  => substr($message, 0, 1000),
                'debug_data'   => self::encode($context),
                'created_at'   => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            error_log('[customaffiliate][' . $level . '] ' . $message . ' (log write failed: ' . $e->getMessage() . ')');
        } finally {
            self::$writing = false;
        }

        // Surface real problems in the WHMCS activity log too, where admins
        // are already looking.
        if ($level === self::LEVEL_ERROR && function_exists('logActivity')) {
            logActivity('Custom Affiliate Commission: ' . substr($message, 0, 400));
        }
    }

    /**
     * @param array<string,mixed> $context
     */
    private static function encode(array $context): ?string
    {
        unset($context['level']);

        if (!$context) {
            return null;
        }

        $json = json_encode($context);

        return $json === false ? null : substr($json, 0, 4000);
    }

    /**
     * Recent log entries for the admin UI.
     *
     * @return array<int,object>
     */
    public static function recent(int $limit = 50, string $level = '', string $action = ''): array
    {
        try {
            $query = Capsule::table(self::TABLE)->orderBy('id', 'desc');

            if ($level !== '') {
                $query->where('level', $level);
            }

            if ($action !== '') {
                $query->where('action', $action);
            }

            return $query->limit(max(1, min($limit, 500)))->get()->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    /**
     * Housekeeping: drop entries older than $days (called from the daily cron).
     */
    public static function prune(int $days): int
    {
        if ($days <= 0) {
            return 0;
        }

        try {
            return (int) Capsule::table(self::TABLE)
                ->where('created_at', '<', date('Y-m-d H:i:s', strtotime('-' . $days . ' days')))
                ->delete();
        } catch (\Throwable $e) {
            return 0;
        }
    }
}
