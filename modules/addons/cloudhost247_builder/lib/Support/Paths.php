<?php
namespace CloudHost247\Builder\Support;

/**
 * Filesystem boundary for the builder.
 *
 * The only directory the builder ever writes to is the media root. Every
 * destination is derived here and re-checked against a resolved containment
 * root, so an uploaded file name cannot influence which directory is written
 * to, and a symlinked ancestor cannot redirect a write outside it.
 */
final class Paths
{
    const ENV_MEDIA_ROOT = 'CH247_BUILDER_MEDIA_ROOT';
    const ENV_MEDIA_URL = 'CH247_BUILDER_MEDIA_URL';
    const DEFAULT_MEDIA_DIRECTORY = 'assets/ch247-media';

    private static $rootOverride = null;
    private static $mediaOverride = null;

    /** Absolute path of the WHMCS document root this overlay is deployed into. */
    public static function applicationRoot()
    {
        if (self::$rootOverride !== null) { return self::$rootOverride; }
        if (defined('ROOTDIR') && is_string(constant('ROOTDIR')) && constant('ROOTDIR') !== '') {
            return rtrim(constant('ROOTDIR'), '/\\');
        }
        // modules/addons/cloudhost247_builder/lib/Support -> document root
        return rtrim(dirname(dirname(dirname(dirname(dirname(__DIR__))))), '/\\');
    }

    /** Test seam. Production code never calls these. */
    public static function overrideApplicationRoot($root)
    {
        self::$rootOverride = $root === null ? null : rtrim((string) $root, '/\\');
    }

    public static function overrideMediaRoot($root)
    {
        self::$mediaOverride = $root === null ? null : rtrim((string) $root, '/\\');
    }

    public static function moduleRoot()
    {
        return dirname(dirname(__DIR__));
    }

    public static function assetDirectory()
    {
        return self::moduleRoot() . '/assets';
    }

    /**
     * Where uploaded media is stored.
     *
     * Media must be reachable by a browser, so unlike module packages it lives
     * inside the document root by default. The directory is created with a
     * hardened .htaccess that refuses to execute anything.
     */
    public static function mediaRoot()
    {
        if (self::$mediaOverride !== null) { return self::$mediaOverride; }
        $configured = getenv(self::ENV_MEDIA_ROOT);
        if (is_string($configured) && trim($configured) !== '') {
            return rtrim(trim($configured), '/\\');
        }
        return self::applicationRoot() . '/' . self::DEFAULT_MEDIA_DIRECTORY;
    }

    /** Public URL prefix matching mediaRoot(). */
    public static function mediaUrlBase()
    {
        $configured = getenv(self::ENV_MEDIA_URL);
        if (is_string($configured) && trim($configured) !== '') {
            return '/' . trim(trim($configured), '/');
        }
        return '/' . trim(self::DEFAULT_MEDIA_DIRECTORY, '/');
    }

    public static function mediaRootIsWritable()
    {
        $root = self::mediaRoot();
        if (is_dir($root)) { return is_writable($root); }
        $parent = dirname($root);
        return is_dir($parent) && is_writable($parent);
    }

    /**
     * Resolve a child path and prove it stays inside $base.
     *
     * Works for paths that do not exist yet: the lexical form is normalised
     * first, then the deepest existing ancestor is compared by realpath.
     *
     * @return string|false absolute path, or false when the path escapes
     */
    public static function containedPath($base, $relative)
    {
        $relative = str_replace('\\', '/', (string) $relative);
        if ($relative === '' || $relative[0] === '/' || strpos($relative, "\0") !== false) { return false; }
        if (preg_match('/^[A-Za-z]:/', $relative) === 1) { return false; }

        $segments = array();
        foreach (explode('/', $relative) as $segment) {
            if ($segment === '' || $segment === '.') { continue; }
            if ($segment === '..') { return false; }
            $segments[] = $segment;
        }
        if (!$segments) { return false; }

        $base = rtrim((string) $base, '/');
        $candidate = $base . '/' . implode('/', $segments);

        $existing = $candidate;
        while ($existing !== '' && $existing !== '/' && !file_exists($existing)) {
            $parent = dirname($existing);
            if ($parent === $existing) { break; }
            $existing = $parent;
        }
        $resolvedBase = realpath($base);
        if ($resolvedBase === false) { return false; }
        $resolvedExisting = realpath($existing);
        if ($resolvedExisting !== false) {
            $normalizedBase = rtrim($resolvedBase, '/') . '/';
            if ($resolvedExisting !== rtrim($resolvedBase, '/')
                && strncmp(rtrim($resolvedExisting, '/') . '/', $normalizedBase, strlen($normalizedBase)) !== 0) {
                return false;
            }
        }
        if (is_link($candidate)) { return false; }
        return $candidate;
    }

    public static function ensureDirectory($path, $mode = 0755)
    {
        if (is_dir($path)) { return true; }
        return @mkdir($path, $mode, true) && is_dir($path);
    }

    /**
     * Harden the media directory.
     *
     * Two layers: the web server is told not to execute anything in there, and
     * the upload pipeline refuses executable content in the first place. Either
     * one alone would be enough on a correctly configured host; both together
     * survive a misconfigured one.
     */
    public static function protectDirectory($path)
    {
        if (!is_dir($path)) { return false; }
        $htaccess = $path . '/.htaccess';
        if (!file_exists($htaccess)) {
            $rules = "# CloudHost247 Website Builder media. Uploaded files are data, never code.\n"
                . "php_flag engine off\n"
                . "AddType text/plain .php .php3 .php4 .php5 .php7 .php8 .phtml .phar .pl .py .cgi .sh .htaccess\n"
                . "<IfModule mod_rewrite.c>\nRewriteEngine Off\n</IfModule>\n"
                . "<FilesMatch \"\\.(php[0-9]?|phtml|phar|pl|py|cgi|sh|so|exe|bat)$\">\n"
                . "  <IfModule mod_authz_core.c>\n    Require all denied\n  </IfModule>\n"
                . "  <IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n  </IfModule>\n"
                . "</FilesMatch>\n"
                . "Options -Indexes -ExecCGI\n";
            @file_put_contents($htaccess, $rules);
            @chmod($htaccess, 0644);
        }
        $index = $path . '/index.html';
        if (!file_exists($index)) {
            @file_put_contents($index, "<!doctype html><title>Media</title>\n");
            @chmod($index, 0644);
        }
        return true;
    }

    /** Remove a file, refusing to act outside $boundary. */
    public static function removeFile($path, $boundary)
    {
        $resolvedBoundary = realpath($boundary);
        $resolved = realpath($path);
        if ($resolvedBoundary === false || $resolved === false) { return false; }
        $prefix = rtrim($resolvedBoundary, '/') . '/';
        if (strncmp($resolved, $prefix, strlen($prefix)) !== 0) { return false; }
        if (is_link($path) || !is_file($path)) { return false; }
        return (bool) @unlink($path);
    }
}
