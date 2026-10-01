<?php
/**
 * Input validation.
 *
 * Pure functions - no database, no WHMCS - so the rules are fully unit tested.
 * Everything that reaches a provider API or a template goes through here first.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Support;

final class Validator
{
    /**
     * A registrable domain name (no scheme, no path, no wildcard).
     */
    public static function isDomain(string $domain): bool
    {
        $domain = strtolower(trim($domain));

        if ($domain === '' || strlen($domain) > 253 || strpos($domain, '.') === false) {
            return false;
        }

        if (strpos($domain, ' ') !== false || strpos($domain, '/') !== false || strpos($domain, '@') !== false) {
            return false;
        }

        return (bool) preg_match('/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/', $domain);
    }

    public static function normaliseDomain(string $domain): string
    {
        $domain = strtolower(trim($domain));
        $domain = preg_replace('#^https?://#', '', $domain) ?? $domain;
        $domain = explode('/', $domain)[0];

        return rtrim($domain, '.');
    }

    /**
     * A mailbox local part (the bit before the @).
     */
    public static function isLocalPart(string $local): bool
    {
        $local = trim($local);

        if ($local === '' || strlen($local) > 64) {
            return false;
        }

        return (bool) preg_match('/^[a-z0-9]([a-z0-9._\-]*[a-z0-9])?$/i', $local);
    }

    public static function isEmail(string $email): bool
    {
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return false;
        }

        $parts = explode('@', $email);

        return count($parts) === 2 && self::isLocalPart($parts[0]) && self::isDomain($parts[1]);
    }

    /**
     * Build the primary address for a mailbox, rejecting anything malformed.
     *
     * @return string '' when the inputs are not usable
     */
    public static function buildEmail(string $local, string $domain): string
    {
        $local = strtolower(trim($local));
        $domain = self::normaliseDomain($domain);

        if (!self::isLocalPart($local) || !self::isDomain($domain)) {
            return '';
        }

        return $local . '@' . $domain;
    }

    /**
     * Password policy applied before any provider call.
     *
     * Deliberately stricter than the weakest provider: Microsoft requires 8-256
     * with 3 of 4 character classes, Google requires 8+. We enforce 12+ with
     * three classes so one password satisfies every adapter.
     *
     * @return array{valid:bool,reason:string}
     */
    public static function checkPassword(string $password): array
    {
        $length = strlen($password);

        if ($length < 12) {
            return ['valid' => false, 'reason' => 'The password must be at least 12 characters long.'];
        }

        if ($length > 100) {
            return ['valid' => false, 'reason' => 'The password must be 100 characters or fewer.'];
        }

        $classes = 0;
        $classes += preg_match('/[a-z]/', $password) ? 1 : 0;
        $classes += preg_match('/[A-Z]/', $password) ? 1 : 0;
        $classes += preg_match('/[0-9]/', $password) ? 1 : 0;
        $classes += preg_match('/[^a-zA-Z0-9]/', $password) ? 1 : 0;

        if ($classes < 3) {
            return [
                'valid'  => false,
                'reason' => 'The password must combine at least three of: lower case, upper case, digits, symbols.',
            ];
        }

        if (preg_match('/\s/', $password)) {
            return ['valid' => false, 'reason' => 'The password must not contain whitespace.'];
        }

        return ['valid' => true, 'reason' => ''];
    }

    /**
     * Generate a policy-compliant password.
     */
    public static function generatePassword(int $length = 18): string
    {
        $length = max(12, min($length, 64));

        $sets = [
            'abcdefghijkmnopqrstuvwxyz',
            'ABCDEFGHJKLMNPQRSTUVWXYZ',
            '23456789',
            '!@#$%^&*()-_=+',
        ];

        $password = '';

        foreach ($sets as $set) {
            $password .= $set[random_int(0, strlen($set) - 1)];
        }

        $all = implode('', $sets);

        while (strlen($password) < $length) {
            $password .= $all[random_int(0, strlen($all) - 1)];
        }

        // Shuffle without breaking the guaranteed character classes.
        $characters = str_split($password);

        for ($i = count($characters) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            $swap = $characters[$i];
            $characters[$i] = $characters[$j];
            $characters[$j] = $swap;
        }

        return implode('', $characters);
    }

    /**
     * A provider SKU / plan identifier: conservative character set, because it
     * is interpolated into provider URLs.
     */
    public static function isSku(string $sku): bool
    {
        return $sku !== ''
            && strlen($sku) <= 128
            && (bool) preg_match('/^[A-Za-z0-9._\-]+$/', $sku);
    }

    /**
     * Restrict a value to a known set.
     *
     * @param array<int,string> $allowed
     */
    public static function oneOf($value, array $allowed, string $default = ''): string
    {
        $value = is_scalar($value) ? (string) $value : '';

        return in_array($value, $allowed, true) ? $value : $default;
    }

    /**
     * Trim and hard-limit free text before storing or displaying it.
     */
    public static function text($value, int $max = 255): string
    {
        $value = is_scalar($value) ? (string) $value : '';

        return substr(trim(strip_tags($value)), 0, $max);
    }
}
