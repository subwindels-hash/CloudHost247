<?php
namespace CloudHost247\Builder\Support;

/**
 * Page slugs.
 *
 * A slug becomes part of a public URL, so the character set is deliberately
 * narrow and a list of reserved names is refused outright: those names belong
 * to WHMCS itself or to existing CloudHost247 front-end scripts, and a builder
 * page must never be able to shadow the cart, the client area or the login
 * form when pretty URLs are enabled.
 */
final class Slug
{
    const PATTERN = '/^[a-z0-9][a-z0-9-]{1,95}$/';
    const MAX_LENGTH = 96;

    /** Names owned by WHMCS or by the existing front-end scripts in this overlay. */
    const RESERVED = array(
        'admin', 'administrator', 'announcements', 'affiliates', 'cart', 'checkout', 'clientarea', 'contact',
        'configuredomains', 'creditcard', 'dl', 'domainchecker', 'download', 'downloads', 'index', 'init',
        'knowledgebase', 'login', 'logout', 'modules', 'password', 'pwreset', 'register', 'serverstatus',
        'submitticket', 'supporttickets', 'templates', 'upgrade', 'viewinvoice', 'viewticket', 'whmcs',
        'api', 'assets', 'crons', 'includes', 'install', 'vendor',
    );

    public static function isValid($slug)
    {
        return is_string($slug) && preg_match(self::PATTERN, $slug) === 1 && !self::isReserved($slug);
    }

    public static function isReserved($slug)
    {
        return in_array(strtolower((string) $slug), self::RESERVED, true);
    }

    /**
     * Normalise arbitrary text into a slug.
     *
     * Returns an empty string when nothing usable remains, so callers decide
     * whether to fall back or to reject; silently inventing a slug would make
     * a published URL unpredictable.
     */
    public static function make($value)
    {
        $value = strtolower(trim((string) $value));
        if (function_exists('iconv')) {
            $converted = @iconv('UTF-8', 'ASCII//TRANSLIT', $value);
            if (is_string($converted) && $converted !== '') { $value = $converted; }
        }
        $value = preg_replace('/[^a-z0-9]+/', '-', $value);
        $value = trim((string) $value, '-');
        if ($value === '') { return ''; }
        if (strlen($value) > self::MAX_LENGTH) {
            $value = trim(substr($value, 0, self::MAX_LENGTH), '-');
        }
        if (preg_match('/^[a-z0-9]/', $value) !== 1) { $value = 'p-' . $value; }
        return $value;
    }

    /**
     * Derive a slug that does not collide, using the supplied existence probe.
     *
     * @param callable $exists function($slug): bool
     */
    public static function unique($value, callable $exists, $fallback = 'page')
    {
        $base = self::make($value);
        if ($base === '' || self::isReserved($base)) { $base = self::make($fallback); }
        if ($base === '') { $base = 'page'; }
        $candidate = $base;
        $suffix = 2;
        while ($exists($candidate) || self::isReserved($candidate)) {
            $candidate = substr($base, 0, self::MAX_LENGTH - 5) . '-' . $suffix;
            $suffix++;
            if ($suffix > 500) { break; }
        }
        return $candidate;
    }
}
