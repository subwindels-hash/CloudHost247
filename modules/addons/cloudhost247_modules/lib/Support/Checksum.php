<?php
namespace CloudHost247\ModuleManager\Support;

/**
 * SHA-256 helpers.
 *
 * The package checksum is the administrator's only way to prove that the
 * archive the platform installed is the archive the vendor published, so it is
 * computed from the raw bytes before anything is opened or extracted, recorded
 * against every lifecycle event, and shown in the installation preview.
 */
final class Checksum
{
    const ALGORITHM = 'sha256';

    public static function ofFile($path)
    {
        if (!is_file($path) || !is_readable($path)) { return ''; }
        $hash = @hash_file(self::ALGORITHM, $path);
        return is_string($hash) ? $hash : '';
    }

    public static function ofString($value)
    {
        return hash(self::ALGORITHM, (string) $value);
    }

    public static function matches($expected, $actual)
    {
        $expected = (string) $expected;
        $actual = (string) $actual;
        if ($expected === '' || $actual === '') { return false; }
        return hash_equals($expected, $actual);
    }

    /** Short form for display. The full value is always available on the details page. */
    public static function short($checksum)
    {
        $checksum = (string) $checksum;
        return $checksum === '' ? 'unavailable' : substr($checksum, 0, 16) . '…';
    }
}
