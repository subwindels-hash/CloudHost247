<?php
namespace CloudHost247\Marketing\Domain;

/**
 * Closed set of consent states (requirement #6, #34).
 *
 * Consent is recorded separately from status on purpose: an address can be
 * "subscribed" because an administrator imported it with a legitimate basis
 * while its consent evidence is still `unknown`, and the honest answer at
 * audit time must be `unknown` — never a fabricated "granted".
 */
final class ConsentStatus
{
    const GRANTED = 'granted';
    const REVOKED = 'revoked';
    const UNKNOWN = 'unknown';

    private static $labels = array(
        self::GRANTED => 'Consent granted',
        self::REVOKED => 'Consent revoked',
        self::UNKNOWN => 'No consent evidence recorded',
    );

    public static function all() { return array_keys(self::$labels); }

    public static function label($status)
    {
        $status = (string) $status;
        return isset(self::$labels[$status]) ? self::$labels[$status] : 'Unknown';
    }

    public static function isValid($status) { return isset(self::$labels[(string) $status]); }
}
