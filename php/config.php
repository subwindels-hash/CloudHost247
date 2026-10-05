<?php
/**
 * CloudHost247 — shared PHP layer configuration.
 *
 * These pages are the PHP front of the CloudHost247 website. They share one
 * design system with the static platform site and pull every price, plan,
 * extension and article live from the CloudHost247 platform API — nothing on
 * these pages is invented. When the API cannot be reached the pages say so
 * explicitly instead of showing stale or made-up data.
 *
 * Every knob can be overridden through environment variables so the same code
 * runs on a LiteSpeed shared host, behind a reverse proxy, or locally.
 */

declare(strict_types=1);

if (!function_exists('ch247_env')) {
    /**
     * Environment value with a default. Empty strings count as unset so an
     * accidentally blank env var never silently disables a setting.
     */
    function ch247_env(string $key, string $default): string
    {
        $value = getenv($key);
        if ($value === false || trim($value) === '') {
            return $default;
        }
        return $value;
    }
}

if (!defined('CH247_API_BASE')) {
    /** Internal base URL of the CloudHost247 platform API. */
    define('CH247_API_BASE', rtrim(ch247_env('CH247_API_BASE', 'http://127.0.0.1:3000'), '/'));
}

if (!defined('CH247_PUBLIC_URL')) {
    /**
     * Canonical public origin used for canonical/OG URLs and sitemap entries.
     * When empty it is derived from the incoming request at render time.
     */
    define('CH247_PUBLIC_URL', rtrim(ch247_env('CH247_PUBLIC_URL', ''), '/'));
}

if (!defined('CH247_APP_BASE')) {
    /**
     * Where the client-area application is served (login, dashboard, cart).
     * Defaults to the same origin; point it at the platform's public URL when
     * the Node application runs on another host or sub-path.
     */
    define('CH247_APP_BASE', rtrim(ch247_env('CH247_APP_BASE', ''), '/'));
}

if (!defined('CH247_ASSET_BASE')) {
    /**
     * Where the shared design-system assets live. The whole site (static pages
     * and these PHP pages) uses the same CSS/JS so there is exactly one look.
     */
    define('CH247_ASSET_BASE', rtrim(ch247_env('CH247_ASSET_BASE', '/platform/public'), '/'));
}

if (!defined('CH247_BRAND')) {
    define('CH247_BRAND', 'CloudHost247');
}

if (!defined('CH247_LEGAL_ENTITY')) {
    define('CH247_LEGAL_ENTITY', 'CloudHost247 Isc.');
}
