<?php
namespace CloudHost247\Marketing\Security;

/** Central validation for every value that reaches the marketing engine. */
final class InputValidator
{
    public static function email($value, $field = 'email')
    {
        $value = strtolower(trim((string) $value));
        if (strlen($value) > 190 || !filter_var($value, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('Invalid email address (' . $field . ').');
        }
        if (preg_match('/[\x00-\x1f\x7f\s]/u', $value)) {
            throw new \InvalidArgumentException('Invalid email address (' . $field . ').');
        }
        return $value;
    }

    /** Lenient check used by import screening (import records the bad row instead of throwing). */
    public static function isPlausibleEmail($value)
    {
        try { self::email($value); return true; } catch (\InvalidArgumentException $e) { return false; }
    }

    public static function domainPart($email)
    {
        $at = strrpos((string) $email, '@');
        return $at === false ? '' : strtolower(substr($email, $at + 1));
    }

    public static function shortText($value, $max, $field)
    {
        $value = trim((string) $value);
        if (function_exists('mb_strlen') ? mb_strlen($value) > $max : strlen($value) > $max) {
            throw new \InvalidArgumentException($field . ' must be ' . $max . ' characters or fewer.');
        }
        return $value;
    }

    public static function key($value, $field)
    {
        $value = strtolower(trim((string) $value));
        if (!preg_match('/^[a-z0-9][a-z0-9_-]{0,63}$/', $value)) {
            throw new \InvalidArgumentException($field . ' must be a lowercase key (a-z, 0-9, - and _).');
        }
        return $value;
    }

    public static function idempotencyKey($value)
    {
        $value = trim((string) $value);
        if ($value === '' || strlen($value) > 100 || !preg_match('/^[A-Za-z0-9:_=.@-]+$/', $value)) {
            throw new \InvalidArgumentException('Invalid idempotency key.');
        }
        return $value;
    }

    public static function positiveInt($value, $min, $max, $field)
    {
        $value = (int) $value;
        if ($value < $min || $value > $max) {
            throw new \InvalidArgumentException($field . ' must be between ' . $min . ' and ' . $max . '.');
        }
        return $value;
    }

    public static function hexToken($value, $field = 'token')
    {
        $value = strtolower(trim((string) $value));
        if (!preg_match('/^[a-f0-9]{64}$/', $value)) {
            throw new \InvalidArgumentException('Invalid ' . $field . '.');
        }
        return $value;
    }

    /** http/https URL only (no javascript:, data:, protocol-relative tricks). */
    public static function url($value, $field = 'URL')
    {
        $value = trim((string) $value);
        $parts = @parse_url($value);
        $scheme = is_array($parts) && isset($parts['scheme']) ? strtolower((string) $parts['scheme']) : '';
        $host = is_array($parts) && isset($parts['host']) ? (string) $parts['host'] : '';
        if (($scheme !== 'https' && $scheme !== 'http') || $host === '' || strlen($value) > 2000) {
            throw new \InvalidArgumentException('Invalid ' . strtolower((string) $field) . ' (http/https only).');
        }
        return $value;
    }
}
