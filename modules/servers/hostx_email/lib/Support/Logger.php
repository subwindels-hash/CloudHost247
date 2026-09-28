<?php
/**
 * Structured, redacted logging.
 *
 * Two sinks:
 *   1. mod_hostx_email_log  - the module's own structured log (queryable from
 *      the client area's admin tab and the CLI tools)
 *   2. logModuleCall()      - WHMCS's native module log, so operators find the
 *      entries where they already look
 *
 * Both are redacted through Redactor. Passwords, OAuth tokens, API keys,
 * service-account private keys and Authorization headers never reach either.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Support;

use WHMCS\Database\Capsule;

final class Logger
{
    const TABLE = 'mod_hostx_email_log';

    const LEVEL_DEBUG   = 'debug';
    const LEVEL_INFO    = 'info';
    const LEVEL_WARNING = 'warning';
    const LEVEL_ERROR   = 'error';

    /** @var string|null Correlation id shared by every entry of one operation. */
    private static $correlationId;

    /** @var bool Recursion guard for failures inside the logger itself. */
    private static $writing = false;

    /**
     * Correlation id for the current request/operation.
     */
    public static function correlationId(bool $fresh = false): string
    {
        if ($fresh || self::$correlationId === null) {
            try {
                self::$correlationId = 'hxe-' . bin2hex(random_bytes(8));
            } catch (\Throwable $e) {
                self::$correlationId = 'hxe-' . substr(md5((string) microtime(true) . (string) mt_rand()), 0, 16);
            }
        }

        return self::$correlationId;
    }

    public static function setCorrelationId(string $id): void
    {
        self::$correlationId = substr(preg_replace('/[^A-Za-z0-9\-]/', '', $id) ?: 'hxe', 0, 64);
    }

    /**
     * @param array<string,mixed> $context
     */
    public static function debug(string $event, array $context = []): void
    {
        self::write(self::LEVEL_DEBUG, $event, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    public static function info(string $event, array $context = []): void
    {
        self::write(self::LEVEL_INFO, $event, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    public static function warning(string $event, array $context = []): void
    {
        self::write(self::LEVEL_WARNING, $event, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    public static function error(string $event, array $context = []): void
    {
        self::write(self::LEVEL_ERROR, $event, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    public static function write(string $level, string $event, array $context = []): void
    {
        $safe = Redactor::redact($context);

        if (self::$writing) {
            error_log('[hostx_email][' . $level . '] ' . $event);

            return;
        }

        self::$writing = true;

        try {
            $encoded = json_encode($safe);

            Capsule::table(self::TABLE)->insert([
                'correlation_id' => self::correlationId(),
                'level'          => in_array($level, [self::LEVEL_DEBUG, self::LEVEL_INFO, self::LEVEL_WARNING, self::LEVEL_ERROR], true)
                    ? $level
                    : self::LEVEL_INFO,
                'service_id'     => isset($context['service_id']) ? (int) $context['service_id'] : null,
                'provider'       => isset($context['provider']) ? substr((string) $context['provider'], 0, 32) : null,
                'event'          => substr($event, 0, 96),
                'context_json'   => substr($encoded === false ? '{}' : $encoded, 0, 8000),
                'created_at'     => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            error_log('[hostx_email][' . $level . '] ' . $event . ' (log write failed: ' . $e->getMessage() . ')');
        } finally {
            self::$writing = false;
        }
    }

    /**
     * Mirror a provider API call into the WHMCS module log, fully redacted.
     *
     * @param array<string,mixed> $request
     * @param array<string,mixed> $response
     */
    public static function moduleCall(string $action, array $request, array $response, string $description = ''): void
    {
        if (!function_exists('logModuleCall')) {
            return;
        }

        try {
            logModuleCall(
                HOSTX_EMAIL_MODULE,
                substr($action, 0, 64),
                Redactor::redact($request),
                Redactor::redact($response),
                $description !== '' ? Redactor::scrub($description) : '',
                // Replacement values: belt and braces on top of Redactor.
                self::replacements($request, $response)
            );
        } catch (\Throwable $e) {
            error_log('[hostx_email] logModuleCall failed: ' . $e->getMessage());
        }
    }

    /**
     * Values WHMCS must mask wherever they appear in the logged payloads.
     *
     * @param  array<string,mixed> $request
     * @param  array<string,mixed> $response
     * @return array<int,string>
     */
    private static function replacements(array $request, array $response): array
    {
        $values = [];

        $collect = static function ($data) use (&$collect, &$values) {
            foreach ((array) $data as $key => $value) {
                if (is_array($value)) {
                    $collect($value);
                    continue;
                }

                if (is_string($value) && $value !== '' && Redactor::isSensitiveKey((string) $key)) {
                    $values[] = $value;
                }
            }
        };

        $collect($request);
        $collect($response);

        return array_values(array_unique($values));
    }

    /**
     * Recent structured log entries.
     *
     * @return array<int,object>
     */
    public static function recent(int $serviceId = 0, int $limit = 50): array
    {
        try {
            $query = Capsule::table(self::TABLE)->orderBy('id', 'desc');

            if ($serviceId > 0) {
                $query->where('service_id', $serviceId);
            }

            return $query->limit(max(1, min($limit, 500)))->get()->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    /**
     * Retention housekeeping, called from the cron runner.
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
