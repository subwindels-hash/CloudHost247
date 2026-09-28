<?php
/**
 * Security helpers: CSRF protection, input validation and output escaping.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

class Security
{
    const SESSION_KEY = 'phoneservices_csrf';

    /**
     * Issue (and remember) a CSRF token for the current session.
     */
    public static function csrfToken(): string
    {
        if (session_status() === PHP_SESSION_NONE && php_sapi_name() !== 'cli' && !headers_sent()) {
            @session_start();
        }

        if (empty($_SESSION[self::SESSION_KEY])) {
            $_SESSION[self::SESSION_KEY] = Crypto::randomToken(24);
        }

        return (string) $_SESSION[self::SESSION_KEY];
    }

    /**
     * Hidden input for module forms.
     */
    public static function csrfField(): string
    {
        return '<input type="hidden" name="phoneservices_token" value="' . self::escape(self::csrfToken()) . '">';
    }

    /**
     * Validate a submitted token. WHMCS's own token is accepted too, so forms
     * built with {$csrfToken} keep working.
     *
     * @param array<string,mixed> $request
     */
    public static function verifyCsrf(array $request): bool
    {
        $expected = self::csrfToken();
        $provided = (string) ($request['phoneservices_token'] ?? ($request['token'] ?? ''));

        if ($provided !== '' && Crypto::secureCompare($expected, $provided)) {
            return true;
        }

        if ($provided !== '' && function_exists('check_token')) {
            // Defer to WHMCS when the form used its native token.
            return (bool) @check_token('WHMCS.admin.default', $provided);
        }

        Logger::warning('CSRF validation failed', ['uri' => $_SERVER['REQUEST_URI'] ?? '']);

        return false;
    }

    /**
     * Escape for HTML output.
     *
     * @param mixed $value
     */
    public static function escape($value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /**
     * Validate an E.164 phone number.
     */
    public static function isValidPhoneNumber(string $number): bool
    {
        return (bool) preg_match('/^\+[1-9]\d{6,14}$/', $number);
    }

    public static function isValidCountryCode(string $country): bool
    {
        return (bool) preg_match('/^[A-Za-z]{2}$/', $country);
    }

    /**
     * Whitelist filter.
     *
     * @param mixed $value
     * @param string[] $allowed
     */
    public static function oneOf($value, array $allowed, string $default): string
    {
        $value = is_scalar($value) ? (string) $value : '';

        return in_array($value, $allowed, true) ? $value : $default;
    }

    /**
     * Sanitise a free-text field (strips control characters, trims, limits).
     *
     * @param mixed $value
     */
    public static function text($value, int $maxLength = 1000): string
    {
        $value = is_scalar($value) ? (string) $value : '';
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value);

        return mb_substr(trim((string) $value), 0, $maxLength);
    }

    /**
     * Simple fixed-window rate limiter backed by the module log table.
     *
     * @return bool True when the action is allowed.
     */
    public static function rateLimit(string $bucket, int $maxAttempts, int $windowSeconds): bool
    {
        $key = 'ratelimit:' . $bucket;
        $now = time();

        $row = Database::row('mod_phoneservices_settings', '*', ['setting_name' => $key]);
        $state = $row ? json_decode((string) $row['setting_value'], true) : null;

        if (!is_array($state) || ($state['reset'] ?? 0) < $now) {
            $state = ['count' => 0, 'reset' => $now + $windowSeconds];
        }

        $state['count']++;
        $allowed = $state['count'] <= $maxAttempts;

        if ($row) {
            Database::update('mod_phoneservices_settings', [
                'setting_value' => json_encode($state),
                'updated_at'    => date('Y-m-d H:i:s'),
            ], ['setting_name' => $key]);
        } else {
            Database::insert('mod_phoneservices_settings', [
                'setting_name'  => $key,
                'setting_value' => json_encode($state),
                'created_at'    => date('Y-m-d H:i:s'),
                'updated_at'    => date('Y-m-d H:i:s'),
            ]);
        }

        if (!$allowed) {
            Logger::warning('Rate limit exceeded', ['bucket' => $bucket, 'limit' => $maxAttempts]);
        }

        return $allowed;
    }

    /**
     * Currently authenticated client id (0 when not logged in).
     */
    public static function currentClientId(): int
    {
        if (isset($_SESSION['uid'])) {
            return (int) $_SESSION['uid'];
        }

        try {
            if (class_exists('\\WHMCS\\Session')) {
                return (int) \WHMCS\Session::get('uid');
            }
        } catch (\Throwable $e) {
            // Fall through to unauthenticated.
        }

        return 0;
    }

    /**
     * Ownership guard: does this client own the record?
     */
    public static function assertOwnership(string $table, int $recordId, int $clientId): bool
    {
        if ($recordId <= 0 || $clientId <= 0) {
            return false;
        }

        $row = Database::row($table, 'user_id', ['id' => $recordId]);

        if (!$row || (int) $row['user_id'] !== $clientId) {
            Logger::warning('Ownership check failed', [
                'table'  => $table,
                'record' => $recordId,
                'client' => $clientId,
            ]);
            return false;
        }

        return true;
    }
}
