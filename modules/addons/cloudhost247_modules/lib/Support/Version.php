<?php
namespace CloudHost247\ModuleManager\Support;

/**
 * Conservative dotted-version handling.
 *
 * Only digits and dots are accepted, with an optional pre-release suffix that
 * is compared lexically after the numeric components. Anything unparsable is
 * rejected rather than guessed, because version comparison decides whether an
 * upload is an install, an update or a downgrade.
 */
final class Version
{
    const PATTERN = '/^[0-9]+(\.[0-9]+){0,3}(-[0-9A-Za-z.]{1,32})?$/';

    public static function isValid($version)
    {
        return is_string($version) && $version !== '' && (bool) preg_match(self::PATTERN, $version);
    }

    /** @return int -1, 0 or 1 */
    public static function compare($left, $right)
    {
        $leftParts = self::split($left);
        $rightParts = self::split($right);
        $length = max(count($leftParts['numbers']), count($rightParts['numbers']));
        for ($index = 0; $index < $length; $index++) {
            $a = isset($leftParts['numbers'][$index]) ? $leftParts['numbers'][$index] : 0;
            $b = isset($rightParts['numbers'][$index]) ? $rightParts['numbers'][$index] : 0;
            if ($a !== $b) { return $a < $b ? -1 : 1; }
        }
        // A release outranks any pre-release of the same numeric version.
        if ($leftParts['pre'] === $rightParts['pre']) { return 0; }
        if ($leftParts['pre'] === '') { return 1; }
        if ($rightParts['pre'] === '') { return -1; }
        return strcmp($leftParts['pre'], $rightParts['pre']) < 0 ? -1 : 1;
    }

    /** Inclusive range test. An empty bound means "unbounded". */
    public static function satisfies($version, $minimum, $maximum)
    {
        if (!self::isValid($version)) { return false; }
        if ($minimum !== '' && $minimum !== null && self::compare($version, $minimum) < 0) { return false; }
        if ($maximum !== '' && $maximum !== null && self::compare($version, $maximum) > 0) { return false; }
        return true;
    }

    /** Reduce a runtime version such as "8.2.33-1+ubuntu" to "8.2.33". */
    public static function normalizeRuntime($version)
    {
        if (preg_match('/^([0-9]+(?:\.[0-9]+){0,3})/', (string) $version, $matches)) {
            return $matches[1];
        }
        return '0';
    }

    public static function describeChange($from, $to)
    {
        $direction = self::compare($to, $from);
        if ($direction > 0) { return 'upgrade'; }
        if ($direction < 0) { return 'downgrade'; }
        return 'reinstall';
    }

    private static function split($version)
    {
        $version = (string) $version;
        $pre = '';
        $dash = strpos($version, '-');
        if ($dash !== false) {
            $pre = substr($version, $dash + 1);
            $version = substr($version, 0, $dash);
        }
        $numbers = array();
        foreach (explode('.', $version) as $part) {
            $numbers[] = ctype_digit($part) ? (int) $part : 0;
        }
        return array('numbers' => $numbers, 'pre' => $pre);
    }
}
