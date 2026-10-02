<?php
namespace CloudHost247\NetworkTools\Ui;

/**
 * Human formatting for values that came from a tool result.
 *
 * Presentation only: it never invents a value. An absent field stays an em
 * dash, an unknown status keeps its own name, and a boolean becomes Yes/No
 * rather than being silently dropped.
 */
final class Format
{
    public static function label($key)
    {
        $key = str_replace(array('-', '_'), ' ', (string) $key);
        $key = preg_replace('/(?<=[a-z0-9])(?=[A-Z])/', ' ', $key);
        return ucfirst(trim($key));
    }

    public static function value($value, $key = '')
    {
        if ($value === null) {
            return '—';
        }
        if (is_bool($value)) {
            return $value ? 'Yes' : 'No';
        }
        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }
        if (is_array($value)) {
            return self::summariseArray($value);
        }
        $string = (string) $value;
        if ($string === '') {
            return '—';
        }
        return $string;
    }

    public static function summariseArray(array $value)
    {
        if (!$value) {
            return '—';
        }
        $parts = array();
        foreach ($value as $key => $entry) {
            if (is_scalar($entry) || $entry === null) {
                $parts[] = (is_string($key) ? self::label($key) . ': ' : '') . self::value($entry);
            } else {
                $parts[] = (is_string($key) ? self::label($key) . ': ' : '') . '…';
            }
            if (count($parts) >= 4) {
                break;
            }
        }
        return implode(', ', $parts);
    }

    /** Tailwind-ish tone classes used by the theme, kept side-effect free. */
    public static function tone($status)
    {
        $status = strtoupper((string) $status);
        if (in_array($status, array('PASS', 'OK', 'ACTIVE', 'PROPAGATED', 'AVAILABLE', 'FOUND', 'VERIFIED', 'OPEN', 'SECURE'), true)) {
            return 'success';
        }
        if (in_array($status, array('WARNING', 'NOT PROPAGATED', 'NOT_PROPAGATED', 'MISMATCH', 'LIKELY', 'REDIRECT', 'PENDING', 'LONG', 'SHORT', 'PARTIAL'), true)) {
            return 'warning';
        }
        if (in_array($status, array('ERROR', 'FAIL', 'BROKEN', 'EXPIRED', 'BLOCKED', 'TARGET_BLOCKED', 'DISABLED', 'UNREACHABLE', 'REGISTERED', 'TIMEOUT'), true)) {
            return 'danger';
        }
        if (in_array($status, array('NOT CHECKED', 'NOT_CHECKED', 'UNKNOWN', 'SKIPPED'), true)) {
            return 'muted';
        }
        return 'info';
    }

    public static function bytes($bytes)
    {
        $bytes = (int) $bytes;
        if ($bytes < 1024) {
            return $bytes . ' B';
        }
        if ($bytes < 1048576) {
            return round($bytes / 1024, 1) . ' KiB';
        }
        return round($bytes / 1048576, 2) . ' MiB';
    }
}
