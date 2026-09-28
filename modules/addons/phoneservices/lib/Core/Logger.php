<?php
/**
 * Logger - centralised, structured logging with retention.
 *
 * Writes to mod_phoneservices_logs, mirrors errors into the WHMCS activity log
 * and degrades to the PHP error log if the database is unavailable. Re-entrancy
 * is guarded so a failing write can never recurse (the data layer logs through
 * this class).
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

class Logger
{
    const LEVEL_DEBUG = 'debug';
    const LEVEL_INFO = 'info';
    const LEVEL_WARNING = 'warning';
    const LEVEL_ERROR = 'error';

    /** Keys scrubbed from context before persistence. */
    const REDACT_KEYS = ['password', 'auth_token', 'api_key', 'api_secret', 'access_token', 'secret', 'token', 'authorization'];

    /** @var bool Re-entrancy guard */
    private static $writing = false;

    /**
     * @param array<string,mixed> $context
     */
    public static function log(string $level, string $message, array $context = []): void
    {
        if (self::$writing) {
            // A log write is already in flight (e.g. the DB layer failed):
            // fall back to the PHP error log to avoid infinite recursion.
            error_log('[phoneservices][' . $level . '] ' . $message);
            return;
        }

        self::$writing = true;

        try {
            $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3);
            $caller = $trace[2] ?? ($trace[1] ?? ($trace[0] ?? []));
            $source = ($caller['class'] ?? '') . ($caller['type'] ?? '') . ($caller['function'] ?? 'unknown');

            $data = [
                'level'      => $level,
                'message'    => mb_substr($message, 0, 2000),
                'context'    => json_encode(self::redact($context)),
                'source'     => mb_substr($source, 0, 190),
                'ip_address' => self::clientIp(),
                'created_at' => date('Y-m-d H:i:s'),
            ];

            try {
                \WHMCS\Database\Capsule::table('mod_phoneservices_logs')->insert($data);
            } catch (\Throwable $e) {
                error_log('[phoneservices][' . $level . '] ' . $message . ' (log write failed: ' . $e->getMessage() . ')');
            }

            if ($level === self::LEVEL_ERROR && function_exists('logActivity')) {
                logActivity('PhoneServices Error: ' . mb_substr($message, 0, 500));
            }
        } finally {
            self::$writing = false;
        }
    }

    public static function debug(string $message, array $context = []): void
    {
        if (self::isDebugMode()) {
            self::log(self::LEVEL_DEBUG, $message, $context);
        }
    }

    public static function info(string $message, array $context = []): void
    {
        self::log(self::LEVEL_INFO, $message, $context);
    }

    public static function warning(string $message, array $context = []): void
    {
        self::log(self::LEVEL_WARNING, $message, $context);
    }

    public static function error(string $message, array $context = []): void
    {
        self::log(self::LEVEL_ERROR, $message, $context);
    }

    /**
     * Log an exception with its origin.
     */
    public static function exception(\Throwable $e, string $context = ''): void
    {
        self::error(($context !== '' ? $context . ': ' : '') . $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
        ]);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public static function getRecentLogs(int $limit = 100, ?string $level = null, array $extraFilters = []): array
    {
        $where = $extraFilters;
        if ($level) {
            $where['level'] = $level;
        }

        return Database::select('mod_phoneservices_logs', '*', $where, 'id', 'DESC', max(1, min($limit, 1000)));
    }

    /**
     * Delete logs older than the configured retention window.
     */
    public static function cleanOldLogs(): int
    {
        $retentionDays = max(1, Config::getInt('log_retention_days', 90));
        $cutoffDate = date('Y-m-d H:i:s', strtotime("-{$retentionDays} days"));

        $affected = Database::statement(
            'DELETE FROM mod_phoneservices_logs WHERE created_at < ?',
            [$cutoffDate]
        );

        if ($affected > 0) {
            self::info("Pruned {$affected} log records older than {$retentionDays} days");
        }

        return $affected;
    }

    public static function isDebugMode(): bool
    {
        return Config::getBool('debug_logging', false) || Config::isSandbox();
    }

    /**
     * Remove secrets from log context.
     *
     * @param array<string,mixed> $context
     * @return array<string,mixed>
     */
    private static function redact(array $context): array
    {
        foreach ($context as $key => $value) {
            if (is_array($value)) {
                $context[$key] = self::redact($value);
                continue;
            }

            foreach (self::REDACT_KEYS as $needle) {
                if (stripos((string) $key, $needle) !== false) {
                    $context[$key] = '***redacted***';
                    break;
                }
            }
        }

        return $context;
    }

    private static function clientIp(): string
    {
        if (php_sapi_name() === 'cli') {
            return 'cli';
        }

        $ip = $_SERVER['REMOTE_ADDR'] ?? '';

        return is_string($ip) ? substr($ip, 0, 45) : '';
    }
}
