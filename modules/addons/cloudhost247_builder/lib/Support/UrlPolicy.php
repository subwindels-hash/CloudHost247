<?php
namespace CloudHost247\Builder\Support;

/**
 * The only place a URL is allowed into a rendered page.
 *
 * Anything that ends up in href, src, background-image or a form action passes
 * through here first. The policy is an allowlist: site-relative paths, HTTPS,
 * plain HTTP, mailto and tel for links, nothing else. javascript:, data:,
 * vbscript:, protocol-relative and control-character URLs are rejected, which
 * removes the main way a stored document could execute script in a visitor's
 * browser.
 */
final class UrlPolicy
{
    const MAX_LENGTH = 2048;
    const LINK_SCHEMES = array('https', 'http', 'mailto', 'tel');
    const MEDIA_SCHEMES = array('https', 'http');

    /**
     * @return string|null canonical URL, or null when it must not be emitted
     */
    public static function link($url)
    {
        return self::check($url, self::LINK_SCHEMES, true);
    }

    /** Images, video posters, background images and downloads. */
    public static function media($url)
    {
        return self::check($url, self::MEDIA_SCHEMES, false);
    }

    /** Convenience: safe URL or the supplied fallback. */
    public static function linkOr($url, $fallback = '')
    {
        $safe = self::link($url);
        return $safe === null ? (string) $fallback : $safe;
    }

    public static function isSafeLink($url)
    {
        return self::link($url) !== null;
    }

    private static function check($url, array $schemes, $allowFragment)
    {
        if (!is_string($url)) { return null; }
        $url = trim($url);
        if ($url === '') { return ''; }
        if (strlen($url) > self::MAX_LENGTH) { return null; }
        // Control characters, including the tab/newline tricks used to smuggle
        // "java\nscript:" past naive scheme checks.
        if (preg_match('/[\x00-\x1F\x7F]/', $url) === 1) { return null; }
        if (strpos($url, '\\') !== false) { return null; }
        // Protocol-relative URLs inherit the page scheme and hide the host.
        if (strncmp($url, '//', 2) === 0) { return null; }

        if ($url[0] === '#') {
            return $allowFragment && preg_match('/^#[A-Za-z0-9_-]{1,64}$/', $url) === 1 ? $url : null;
        }
        if ($url[0] === '/' || $url[0] === '?') {
            return preg_match('/^[A-Za-z0-9\/_\-.~!$&\'()*+,;=:@%?#]+$/', $url) === 1 ? $url : null;
        }

        $scheme = null;
        $colon = strpos($url, ':');
        if ($colon !== false) {
            $candidate = strtolower(substr($url, 0, $colon));
            // A colon later in a relative path (e.g. cart.php?a=x:y) is not a scheme.
            if (preg_match('/^[a-z][a-z0-9+.-]*$/', $candidate) === 1) { $scheme = $candidate; }
        }

        if ($scheme === null) {
            // Relative script path such as cart.php?a=add&pid=3
            return preg_match('/^[A-Za-z0-9][A-Za-z0-9\/_\-.~]*(\.php)?([?#][A-Za-z0-9\/_\-.~!$&\'()*+,;=:@%]*)?$/', $url) === 1 ? $url : null;
        }
        if (!in_array($scheme, $schemes, true)) { return null; }
        if ($scheme === 'mailto') {
            $address = substr($url, 7);
            return filter_var($address, FILTER_VALIDATE_EMAIL) ? 'mailto:' . $address : null;
        }
        if ($scheme === 'tel') {
            return preg_match('/^tel:\+?[0-9 ().-]{3,32}$/', $url) === 1 ? $url : null;
        }
        if (!filter_var($url, FILTER_VALIDATE_URL)) { return null; }
        $host = parse_url($url, PHP_URL_HOST);
        if (!is_string($host) || $host === '') { return null; }
        return $url;
    }
}
