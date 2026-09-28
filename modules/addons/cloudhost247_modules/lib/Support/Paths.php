<?php
namespace CloudHost247\ModuleManager\Support;

/**
 * Filesystem boundary for the Module Manager.
 *
 * Every destination path is derived here and every write is re-checked against
 * a resolved containment root. Nothing in an uploaded archive is allowed to
 * influence which directory is written to.
 */
final class Paths
{
    /** Module ids are also directory names, so the character set is deliberately narrow. */
    const MODULE_ID_PATTERN = '/^[a-z][a-z0-9_]{2,63}$/';

    /** Reserved directory names that must never be targeted by an install. */
    private static $reserved = array(
        'cloudhost247_core', 'cloudhost247_modules', 'cloudhost247_integrations',
        '.', '..', 'vendor', 'includes', 'admin', 'assets', 'templates',
    );

    private static $rootOverride = null;

    /** Absolute path of the WHMCS document root this overlay is deployed into. */
    public static function applicationRoot()
    {
        if (self::$rootOverride !== null) { return self::$rootOverride; }
        if (defined('ROOTDIR') && is_string(constant('ROOTDIR')) && constant('ROOTDIR') !== '') {
            return rtrim(constant('ROOTDIR'), '/\\');
        }
        // modules/addons/cloudhost247_modules/lib/Support -> document root
        return rtrim(dirname(dirname(dirname(dirname(dirname(__DIR__))))), '/\\');
    }

    /** Test seam. Production code never calls this. */
    public static function overrideApplicationRoot($root)
    {
        self::$rootOverride = $root === null ? null : rtrim((string) $root, '/\\');
    }

    public static function isValidModuleId($moduleId)
    {
        if (!is_string($moduleId) || !preg_match(self::MODULE_ID_PATTERN, $moduleId)) { return false; }
        return !in_array($moduleId, self::$reserved, true);
    }

    public static function isReserved($moduleId)
    {
        return in_array((string) $moduleId, self::$reserved, true);
    }

    /** Path relative to the application root, e.g. modules/servers/example_rdp. */
    public static function relativeModuleDirectory($type, $moduleId)
    {
        return ModuleType::directory($type) . '/' . $moduleId;
    }

    public static function moduleDirectory($type, $moduleId)
    {
        return self::applicationRoot() . '/' . self::relativeModuleDirectory($type, $moduleId);
    }

    /**
     * Resolve a child path and prove it stays inside $base.
     *
     * Works for paths that do not exist yet: the lexical form is normalized
     * first, then the deepest existing ancestor is compared by realpath so a
     * symlinked ancestor cannot redirect the write outside the root.
     *
     * @return string|false absolute path, or false when the path escapes
     */
    public static function containedPath($base, $relative)
    {
        $relative = str_replace('\\', '/', (string) $relative);
        if ($relative === '' || $relative[0] === '/' || strpos($relative, "\0") !== false) { return false; }
        if (preg_match('/^[A-Za-z]:/', $relative)) { return false; }

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
        $resolvedExisting = realpath($existing);
        if ($resolvedBase === false) { return false; }
        if ($resolvedExisting !== false) {
            $normalizedBase = rtrim($resolvedBase, '/') . '/';
            if ($resolvedExisting !== rtrim($resolvedBase, '/')
                && strncmp(rtrim($resolvedExisting, '/') . '/', $normalizedBase, strlen($normalizedBase)) !== 0) {
                return false;
            }
        }
        // A symlink at the exact destination must never be written through.
        if (is_link($candidate)) { return false; }
        return $candidate;
    }

    /** True when $path is inside $base (both must already exist). */
    public static function isInside($base, $path)
    {
        $base = realpath($base);
        $path = realpath($path);
        if ($base === false || $path === false) { return false; }
        $base = rtrim($base, '/') . '/';
        return $path === rtrim($base, '/') || strncmp(rtrim($path, '/') . '/', $base, strlen($base)) === 0;
    }

    /** Recursively delete a directory, refusing to act outside $boundary. */
    public static function removeTree($directory, $boundary)
    {
        if (!is_dir($directory) || is_link($directory)) { return false; }
        if (!self::isInside($boundary, $directory)) { return false; }
        $entries = @scandir($directory);
        if ($entries === false) { return false; }
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') { continue; }
            $path = $directory . '/' . $entry;
            if (is_link($path) || is_file($path)) {
                @unlink($path);
                continue;
            }
            if (is_dir($path)) { self::removeTree($path, $boundary); }
        }
        return @rmdir($directory);
    }

    /** List every regular file under a directory, as paths relative to it. */
    public static function listFiles($directory)
    {
        $found = array();
        if (!is_dir($directory)) { return $found; }
        $stack = array('');
        while ($stack) {
            $prefix = array_pop($stack);
            $absolute = rtrim($directory . '/' . $prefix, '/');
            $entries = @scandir($absolute);
            if ($entries === false) { continue; }
            foreach ($entries as $entry) {
                if ($entry === '.' || $entry === '..') { continue; }
                $relative = $prefix === '' ? $entry : $prefix . '/' . $entry;
                $path = $directory . '/' . $relative;
                if (is_link($path)) { continue; }
                if (is_dir($path)) { $stack[] = $relative; continue; }
                if (is_file($path)) { $found[] = $relative; }
            }
        }
        sort($found);
        return $found;
    }

    public static function ensureDirectory($path, $mode = 0755)
    {
        if (is_dir($path)) { return true; }
        return @mkdir($path, $mode, true) && is_dir($path);
    }
}
