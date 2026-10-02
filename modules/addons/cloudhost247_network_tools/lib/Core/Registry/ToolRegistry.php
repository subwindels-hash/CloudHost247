<?php
namespace CloudHost247\NetworkTools\Core\Registry;

/**
 * The single place where tools are registered.
 *
 * Catalogues are small per-category files (Registry/Catalog/*.php) that return
 * definition arrays. Adding a tool means adding one entry and one service
 * method — no controller, template or route change, because the dashboard, the
 * form renderer, the validator, the REST API and the admin registry all read
 * from here.
 */
final class ToolRegistry
{
    const CATALOG_NAMESPACE = 'CloudHost247\\NetworkTools\\Core\\Registry\\Catalog\\';

    private static $definitions;

    /** @return ToolDefinition[] keyed by slug */
    public static function all()
    {
        if (self::$definitions !== null) {
            return self::$definitions;
        }
        $definitions = array();
        foreach (self::catalogFiles() as $file) {
            $class = self::CATALOG_NAMESPACE . basename($file, '.php');
            if (!class_exists($class)) {
                continue;
            }
            $rows = call_user_func(array($class, 'definitions'));
            if (!is_array($rows)) {
                continue;
            }
            foreach ($rows as $slug => $row) {
                $slug = is_string($slug) ? $slug : (isset($row['slug']) ? $row['slug'] : '');
                if ($slug === '' || !preg_match('#^[a-z0-9]+(/[a-z0-9\-]+)+$#', $slug)) {
                    continue; // a malformed slug is a programming error, not a tool
                }
                $definitions[$slug] = new ToolDefinition($slug, $row);
            }
        }
        ksort($definitions);
        self::$definitions = $definitions;
        return $definitions;
    }

    /**
     * Route aliases.
     *
     * The specification lists a few routes whose canonical slug lives in another
     * category (for example ip/blacklist is the same tool as
     * security/ip-blacklist). An alias resolves to the canonical definition, so
     * there is one implementation, one set of settings and one permission check
     * per tool — never a duplicate.
     */
    public static function aliases()
    {
        return array(
            'ip/blacklist' => 'security/ip-blacklist',
            'ip/black-list' => 'security/ip-blacklist',
            'security/blacklist' => 'security/ip-blacklist',
            'productivity/wifi-qr' => 'productivity/qr-generator',
            'productivity/qr-code-generator' => 'productivity/qr-generator',
            'productivity/qr-code-scanner' => 'productivity/qr-scanner',
            'network/port-check' => 'network/port-checker',
            'developer/headers' => 'developer/http-headers',
            'webmaster/robots' => 'webmaster/robots-generator',
            'diagnostics/health' => 'diagnostics/domain-health',
            'diagnostics/monitoring' => 'diagnostics/monitors',
        );
    }

    /** The canonical slug for any accepted route alias. */
    public static function canonical($slug)
    {
        $slug = (string) $slug;
        $aliases = self::aliases();
        return isset($aliases[$slug]) ? $aliases[$slug] : $slug;
    }

    public static function get($slug)
    {
        $all = self::all();
        $slug = self::canonical($slug);
        return isset($all[$slug]) ? $all[$slug] : null;
    }

    public static function exists($slug)
    {
        return self::get($slug) !== null;
    }

    /** @return ToolDefinition[] */
    public static function byCategory($category)
    {
        $out = array();
        foreach (self::all() as $slug => $definition) {
            if ($definition->category() === $category) {
                $out[$slug] = $definition;
            }
        }
        return $out;
    }

    /** @return ToolDefinition[] */
    public static function visibleTo($audience)
    {
        $out = array();
        foreach (self::all() as $slug => $definition) {
            if (self::isVisibleTo($definition, $audience)) {
                $out[$slug] = $definition;
            }
        }
        return $out;
    }

    public static function isVisibleTo(ToolDefinition $definition, $audience)
    {
        $visibility = $definition->visibility();
        if ($audience === 'admin') {
            return true;
        }
        if ($audience === 'customer') {
            return $visibility !== ToolDefinition::VISIBILITY_ADMIN;
        }
        return $visibility === ToolDefinition::VISIBILITY_PUBLIC;
    }

    /**
     * Free-text search across name, description, category and slug.
     *
     * @return ToolDefinition[]
     */
    public static function search($term, $audience = 'public')
    {
        $term = strtolower(trim((string) $term));
        if ($term === '') {
            return self::visibleTo($audience);
        }
        $terms = array_filter(preg_split('/\s+/', $term));
        $matches = array();
        foreach (self::visibleTo($audience) as $slug => $definition) {
            $haystack = strtolower($definition->name() . ' ' . $definition->summary() . ' ' . $definition->description() . ' ' . $slug . ' ' . $definition->category());
            foreach ($terms as $needle) {
                if (strpos($haystack, $needle) === false) {
                    continue 2;
                }
            }
            $matches[$slug] = $definition;
        }
        return $matches;
    }

    public static function count()
    {
        return count(self::all());
    }

    private static function catalogFiles()
    {
        $files = glob(__DIR__ . '/Catalog/*Catalog.php');
        return is_array($files) ? $files : array();
    }

    /** Test-only: drop the memoised catalogue. */
    public static function reset()
    {
        self::$definitions = null;
    }
}
