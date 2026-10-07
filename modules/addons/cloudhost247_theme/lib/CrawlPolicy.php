<?php
namespace CloudHost247\Theme;

/**
 * One crawl policy for every PHP surface.
 *
 * The policy is authored once, in `shared/site/registry.json` → `sitemap`, and read here from the
 * generated `resources/site.json`. Four surfaces consume it and must never disagree:
 *
 *   1. the Node platform's dynamic `/robots.txt` and `/sitemap.xml` (`SITEMAP_POLICY`);
 *   2. the generated static `robots.txt` (fallback when nothing rewrites it);
 *   3. `robots.php`, which serves the same file with absolute Sitemap URLs;
 *   4. the PHP XML sitemaps, which must never advertise a URL the policy excludes.
 *
 * `FALLBACK_*` mirrors the registry and is used only when `site.json` is missing or unreadable, so
 * a broken resource can never widen what gets crawled. `tests/website/run.php` and the site
 * generator both pin the fallback against the registry, so drift fails a build instead of silently
 * changing crawl behaviour.
 *
 * Crawl guidance only: this class never guards access. Private areas are protected by
 * authentication.
 */
final class CrawlPolicy
{
    /** Mirrors registry `sitemap.excludePhp` (PHP/WHMCS surface). */
    const FALLBACK_PHP_EXCLUSIONS = array(
        'admin/',
        'modules/',
        'crons/',
        'errors/',
        'cart.php',
        'clientarea.php',
        'register.php',
        'pwreset.php',
        'logout.php',
        'submitticket.php',
        'supporttickets.php',
        'viewticket.php',
        'site-search.php',
        'service-error.php',
        'cloudhost247-marketing-track.php',
        'cloudhost247-sample.php',
        'cloudhost247-vps-sample.php',
        'all-element-cloudhost247.php',
        'future-element.php',
        'tables.php',
        'tools/data/',
        'tools/admin/',
        'tools/api.php',
    );

    /** Mirrors registry `sitemap.exclude` (single-page-app surface). */
    const FALLBACK_SPA_EXCLUSIONS = array(
        '/login', '/register', '/forgot-password', '/reset-password', '/verify-email',
        '/dashboard', '/admin', '/account', '/billing', '/invoices', '/cart', '/checkout',
        '/inbox', '/search', '/api/', '/support', '/services', '/marketing', '/servers/new',
        '/websites/builder', '/websites/ai-builder', '/websites/store', '/websites/experts',
        '/websites/templates', '/websites/design-services',
        '/tools/history', '/tools/favorites', '/tools/reports', '/tools/monitors',
    );

    /**
     * Sitemap endpoints. A sitemap that is itself disallowed cannot be fetched, which silently
     * voids the `Sitemap:` directive in robots.txt, so these are never excludable. They carry
     * `X-Robots-Tag: noindex` instead: fetched but never indexed.
     */
    const SITEMAP_ENDPOINTS = array(
        'sitemap.xml',
        'cloudhost247-sitemap.php',
        'tools-sitemap.php',
        'builder-sitemap.php',
    );

    /** The PHP/WHMCS exclusions, from the generated registry resource when it is readable. */
    public static function phpExclusions()
    {
        $policy = self::policy();
        if (isset($policy['excludePhp']) && is_array($policy['excludePhp']) && $policy['excludePhp']) {
            return array_values(array_map('strval', $policy['excludePhp']));
        }
        return self::FALLBACK_PHP_EXCLUSIONS;
    }

    /** The single-page-app exclusions, from the generated registry resource when it is readable. */
    public static function spaExclusions()
    {
        $policy = self::policy();
        if (isset($policy['exclude']) && is_array($policy['exclude']) && $policy['exclude']) {
            return array_values(array_map('strval', $policy['exclude']));
        }
        return self::FALLBACK_SPA_EXCLUSIONS;
    }

    /** Every excluded destination as a root-relative path, deduplicated and sorted. */
    public static function exclusions()
    {
        $paths = array();
        foreach (array_merge(self::spaExclusions(), self::phpExclusions()) as $entry) {
            $path = self::normalise($entry);
            if ($path !== '') { $paths[$path] = true; }
        }
        ksort($paths);
        return array_keys($paths);
    }

    /** True when a crawler may index the destination: not excluded, and a real published URL. */
    public static function isPublic($target)
    {
        $candidate = self::normalise($target);
        if ($candidate === '') { return true; } // the homepage is always public
        foreach (self::exclusions() as $rule) {
            $bare = rtrim($rule, '/');
            if ($candidate === $bare || $candidate === $bare . '/' || strpos($candidate, $bare . '/') === 0) {
                return false;
            }
        }
        return true;
    }

    /** Filters a list of destinations (path or path?query) down to the indexable ones. */
    public static function filter(array $paths)
    {
        $public = array();
        foreach ($paths as $path) {
            if (self::isPublic($path)) { $public[] = $path; }
        }
        return array_values(array_unique($public));
    }

    /** Normalises a policy entry or destination to `path` (root-relative, no query, no scheme). */
    private static function normalise($value)
    {
        $value = trim((string) $value);
        if ($value === '') { return ''; }
        $value = preg_split('~[?#]~', $value);
        $value = $value[0];
        $value = preg_replace('~^[a-z][a-z0-9+.-]*://[^/]+~i', '', $value);
        $value = preg_replace('~^\.?/+~', '', $value);
        if ($value === '') { return ''; } // '/' is the homepage, never a rule
        return '/' . $value;
    }

    /** The `sitemap` block of the generated registry, or an empty array when it is unavailable. */
    private static function policy()
    {
        static $policy;
        if ($policy === null) {
            $policy = array();
            try {
                $catalog = Site::catalog();
                if (isset($catalog['sitemap']) && is_array($catalog['sitemap'])) {
                    $policy = $catalog['sitemap'];
                }
            } catch (\Throwable $unavailable) {
                $policy = array();
            }
        }
        return $policy;
    }
}
