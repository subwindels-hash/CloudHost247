<?php
namespace CloudHost247\Tools;

/** Read-only catalogue plus operator overrides. Overrides never add a tool that is not in the registry. */
final class Catalog
{
    public static function data()
    {
        static $data;
        if ($data === null) {
            $loaded = require CH247_TOOLS_ROOT . '/config/tools.php';
            if (!is_array($loaded) || empty($loaded['tools'])) {
                throw new \RuntimeException('Tools catalogue is unavailable.');
            }
            $data = self::applyOverrides($loaded, self::overrides());
        }
        return $data;
    }

    public static function tools()
    {
        return self::data()['tools'];
    }

    public static function categories()
    {
        return self::data()['categories'];
    }

    public static function find($slug)
    {
        foreach (self::tools() as $tool) {
            if ($tool['slug'] === $slug) {
                return $tool;
            }
        }
        return null;
    }

    /**
     * Resolve a path such as /tools, /tools/category/dns or /tools/dns-lookup.
     * Legacy paths redirect to the canonical tool path.
     */
    public static function resolve($path)
    {
        $path = self::normalise($path);
        if ($path === '/tools') {
            return array('kind' => 'hub', 'path' => '/tools', 'name' => 'CloudHost247 Online Tools', 'summary' => 'Free professional tools for DNS, networking, developers, security, webmasters and digital professionals.', 'slug' => '');
        }
        if (preg_match('#^/tools/category/([a-z0-9-]+)$#', $path, $match)) {
            $categories = self::categories();
            if (!isset($categories[$match[1]])) {
                return null;
            }
            return array(
                'kind' => 'category',
                'path' => $path,
                'slug' => $match[1],
                'name' => $categories[$match[1]] . ' Tools',
                'summary' => 'CloudHost247 ' . $categories[$match[1]] . ' tools, each with its own page and an explicit limitation.',
            );
        }
        if (!preg_match('#^/tools/([a-z0-9-]+)$#', $path, $match)) {
            return null;
        }
        $tool = self::find($match[1]);
        if (!$tool) {
            return null;
        }
        $tool['kind'] = 'tool';
        return $tool;
    }

    public static function search($query)
    {
        $query = strtolower(trim((string) $query));
        if ($query === '' || strlen($query) > 80) {
            return self::enabledTools();
        }
        $out = array();
        foreach (self::enabledTools() as $tool) {
            $hay = strtolower($tool['name'] . ' ' . $tool['category'] . ' ' . $tool['categoryLabel'] . ' ' . $tool['summary'] . ' ' . implode(' ', $tool['keywords']) . ' ' . implode(' ', $tool['aliases']));
            if (strpos($hay, $query) !== false) {
                $out[] = $tool;
            }
        }
        return $out;
    }

    public static function enabledTools()
    {
        $out = array();
        foreach (self::tools() as $tool) {
            if (!empty($tool['enabled'])) {
                $out[] = $tool;
            }
        }
        return $out;
    }

    public static function overridesPath()
    {
        return CH247_TOOLS_ROOT . '/tools/data/overrides.json';
    }

    public static function overrides()
    {
        $path = self::overridesPath();
        if (!is_file($path)) {
            return array();
        }
        $decoded = json_decode((string) file_get_contents($path), true);
        return is_array($decoded) ? $decoded : array();
    }

    public static function saveOverrides(array $overrides)
    {
        $path = self::overridesPath();
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new \RuntimeException('Override directory is not writable.');
        }
        $tmp = $path . '.tmp';
        $json = json_encode($overrides, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if ($json === false || file_put_contents($tmp, $json . "\n", LOCK_EX) === false) {
            throw new \RuntimeException('Override file could not be written.');
        }
        if (!rename($tmp, $path)) {
            throw new \RuntimeException('Override file could not be saved.');
        }
    }

    private static function applyOverrides(array $data, array $overrides)
    {
        $toolOverrides = isset($overrides['tools']) && is_array($overrides['tools']) ? $overrides['tools'] : array();
        $allowed = array('enabled', 'maintenance', 'summary', 'description', 'seoTitle', 'seoDescription', 'category', 'featured', 'icon', 'ratePerMinute');
        foreach ($data['tools'] as $index => $tool) {
            if (empty($toolOverrides[$tool['slug']]) || !is_array($toolOverrides[$tool['slug']])) {
                continue;
            }
            foreach ($allowed as $key) {
                if (!array_key_exists($key, $toolOverrides[$tool['slug']])) {
                    continue;
                }
                $value = $toolOverrides[$tool['slug']][$key];
                if ($key === 'enabled' || $key === 'featured') {
                    $data['tools'][$index][$key] = (bool) $value;
                } elseif ($key === 'ratePerMinute') {
                    $data['tools'][$index][$key] = max(1, min(120, (int) $value));
                } elseif ($key === 'category' && isset($data['categories'][$value])) {
                    $data['tools'][$index]['category'] = $value;
                    $data['tools'][$index]['categoryLabel'] = $data['categories'][$value];
                } elseif (is_string($value)) {
                    $data['tools'][$index][$key] = substr($value, 0, 500);
                }
            }
        }
        if (!empty($overrides['providers']) && is_array($overrides['providers'])) {
            $data['providers'] = $overrides['providers'];
        }
        return $data;
    }

    private static function normalise($path)
    {
        $path = '/' . trim((string) $path, '/');
        if (strpos($path, '..') !== false || strpos($path, '%') !== false || strpos($path, '\\') !== false) {
            return '/tools/invalid';
        }
        return $path === '/' ? '/tools' : $path;
    }
}
