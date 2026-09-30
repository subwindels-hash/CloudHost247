<?php
/**
 * Thin adapter over the existing CloudHost247 Foundation logger
 * (modules/addons/cloudhost247_core/lib/Support/Logger.php). No second
 * logging system is introduced: when Foundation is unavailable the adapter
 * falls back to WHMCS's own logModuleCall / error_log so a logging problem
 * can never break a cart request.
 */

namespace CloudHost247\CartRecovery;

final class Log
{
    const MODULE = 'cloudhost247_cart_recovery';

    /**
     * @param string $level   debug|info|warning|error|critical
     * @param string $event   dotted event name, e.g. "cart.captured"
     * @param array  $context non-sensitive context only (ids, counts, statuses)
     */
    public static function write($level, $event, array $context = array())
    {
        $context = self::scrub($context);
        try {
            if (class_exists('CloudHost247\\Foundation\\Support\\Logger')) {
                \CloudHost247\Foundation\Support\Logger::write(self::MODULE, $level, $event, $context);
                return;
            }
            if (function_exists('logModuleCall') && in_array($level, array('error', 'critical'), true)) {
                logModuleCall(self::MODULE, $event, $context, null, null, array());
                return;
            }
            if (in_array($level, array('error', 'critical'), true)) {
                error_log(self::MODULE . ' ' . $event . ' ' . json_encode($context));
            }
        } catch (\Throwable $e) {
            // Logging must never propagate into the customer request.
        }
    }

    public static function info($event, array $context = array())
    {
        self::write('info', $event, $context);
    }

    public static function error($event, array $context = array())
    {
        self::write('error', $event, $context);
    }

    /**
     * Defence in depth on top of Foundation's SecretPolicy: drop anything that
     * looks like a credential and truncate free text so tokens, passwords or
     * payment data can never reach the log tables.
     */
    public static function scrub(array $context)
    {
        $safe = array();
        foreach ($context as $key => $value) {
            $name = (string) $key;
            if (preg_match('/pass|secret|token|cvv|card|api[_-]?key|credential|auth/i', $name)) {
                $safe[$name] = '[redacted]';
                continue;
            }
            if (is_array($value)) {
                $safe[$name] = self::scrub($value);
            } elseif (is_scalar($value) || $value === null) {
                $safe[$name] = is_string($value) ? substr($value, 0, 300) : $value;
            }
        }
        return $safe;
    }

    /**
     * Error text that is safe to persist: exception messages can contain SQL
     * fragments or credentials, so only the class plus a truncated,
     * credential-stripped message is stored.
     */
    public static function safeError(\Throwable $e)
    {
        $message = preg_replace('/([A-Za-z0-9_\-]{24,})/', '[redacted]', (string) $e->getMessage());
        return substr(get_class($e) . ': ' . $message, 0, 500);
    }
}
