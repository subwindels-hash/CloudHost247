<?php
/**
 * Thin adapter over the existing CloudHost247 Foundation logger
 * (modules/addons/cloudhost247_core/lib/Support/Logger.php). No second
 * logging system is introduced, and a logging failure never propagates into
 * an authentication request.
 */

namespace CloudHost247\Passkey;

final class Log
{
    const MODULE = 'cloudhost247_passkey';

    /** Keys that must never reach a log line, whatever the caller passes. */
    private static $forbidden = array(
        'password', 'passwd', 'secret', 'client_secret', 'token', 'access_token', 'id_token',
        'refresh_token', 'private_key', 'privatekey', 'signature', 'challenge', 'assertion',
        'credential', 'clientdatajson', 'attestationobject', 'authenticatordata', 'code',
    );

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
            // Never propagate.
        }
    }

    public static function info($event, array $context = array())
    {
        self::write('info', $event, $context);
    }

    public static function warning($event, array $context = array())
    {
        self::write('warning', $event, $context);
    }

    public static function error($event, array $context = array())
    {
        self::write('error', $event, $context);
    }

    /**
     * Drops anything that looks like a credential and truncates free text, so
     * challenges, signatures, private keys and OAuth secrets can never be
     * written to the log tables.
     */
    public static function scrub(array $context)
    {
        $safe = array();
        foreach ($context as $key => $value) {
            $name = strtolower((string) $key);
            $sensitive = false;
            foreach (self::$forbidden as $needle) {
                if (strpos($name, $needle) !== false) {
                    $sensitive = true;
                    break;
                }
            }
            if ($sensitive) {
                $safe[$key] = '[redacted]';
                continue;
            }
            if (is_array($value)) {
                $safe[$key] = self::scrub($value);
                continue;
            }
            if (is_bool($value) || is_int($value) || is_float($value) || $value === null) {
                $safe[$key] = $value;
                continue;
            }
            $safe[$key] = mb_substr((string) $value, 0, 200);
        }
        return $safe;
    }

    /** Correlation-friendly, non-leaking rendering of an exception. */
    public static function safeError($e)
    {
        if ($e instanceof PasskeyException) {
            return $e->reason();
        }
        return get_class($e);
    }
}
