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

    /**
     * Canonical discovery taxonomy — the nine categories navigation, the Tools mega menu and the
     * sitemaps publish. It is read from the shared registry projection (`site.json`, written by
     * `scripts/site/generate.mjs` from `shared/site/registry.json`) so the PHP surface and the app
     * publish the same taxonomy; the fallback is the same list compiled, and the generator and
     * `tests/tools/site-integration.php` both fail if the two ever drift.
     */
    const FALLBACK_DISCOVERY = array(
        'dns-domains' => 'DNS & Domains',
        'ip-network' => 'IP & Network',
        'security' => 'Security',
        'ssl' => 'SSL',
        'email' => 'Email',
        'website' => 'Website',
        'developer' => 'Developer',
        'calculators' => 'Calculators',
        'utilities' => 'Utilities',
    );

    public static function discovery()
    {
        static $discovery;
        if ($discovery === null) {
            $discovery = array();
            $registry = CH247_TOOLS_ROOT . '/modules/addons/cloudhost247_theme/resources/site.json';
            $catalog = is_file($registry) ? json_decode((string) file_get_contents($registry), true) : null;
            foreach (is_array($catalog) && isset($catalog['toolCategories']) ? $catalog['toolCategories'] : array() as $category) {
                if (!is_array($category) || !isset($category['label'])) { continue; }
                $slug = isset($category['slug']) ? (string) $category['slug'] : '';
                if ($slug === '' && isset($category['url'])) {
                    // Older projections carried only the URL; derive the slug so a stale resource
                    // degrades to the same taxonomy instead of to the compiled fallback.
                    $path = preg_split('~[?#]~', (string) $category['url']);
                    $slug = substr($path[0], strrpos($path[0], '/') + 1);
                }
                if ($slug !== '') { $discovery[$slug] = (string) $category['label']; }
            }
            if (!$discovery) { $discovery = self::FALLBACK_DISCOVERY; }
        }
        return $discovery;
    }

    /**
     * The discovery categories a tool belongs to. The first entry is the primary one, used for the
     * breadcrumb, and the rest are cross-listings. The rules mirror the app catalogue
     * (`cloudhost247-node/src/tools/catalog.ts`): one engine→discovery mapping plus curated
     * cross-listing for the families that belong in more than one place.
     */
    public static function discoveryCategories(array $tool)
    {
        $slug = isset($tool['slug']) ? (string) $tool['slug'] : '';
        $engine = isset($tool['category']) ? (string) $tool['category'] : '';
        $map = array(
            'dns' => 'dns-domains', 'domain' => 'dns-domains',
            'ip' => 'ip-network', 'network' => 'ip-network',
            'webmaster' => 'website', 'productivity' => 'utilities', 'diagnostics' => 'utilities',
            'security' => 'security', 'developer' => 'developer', 'designer' => 'website',
            'cybersecurity' => 'security', 'gaming' => 'utilities',
        );
        $categories = array(isset($map[$engine]) ? $map[$engine] : 'utilities');
        $extra = array(
            'email' => array('mx-lookup', 'spf-record-checker', 'spf-record-generator', 'dkim-checker', 'dmarc-checker', 'dmarc-record-generator', 'bimi-checker-generator', 'smtp-test', 'trace-email', 'email-verifier'),
            'ssl' => array('ssl-certificate-checker'),
            'website' => array('http-headers-checker', 'website-os-checker', 'broken-link-checker', 'open-graph-checker', 'website-link-analyzer', 'pagerank-checker', 'serp-simulator', 'robots-txt-generator', 'punycode-converter', 'user-agent-checker', 'htaccess-redirect-generator', 'url-rewrite-generator'),
            'calculators' => array('ip-subnet-calculator', 'ip-to-decimal', 'ipv4-to-ipv6', 'ipv6-cidr-to-range', 'ipv6-range-to-cidr', 'time-card-calculator', 'raid-calculator', 'rgb-to-colortone', 'hex-to-colortone', 'cmyk-to-colortone', 'hsv-to-colortone'),
            'utilities' => array('qr-code-generator', 'qr-scanner', 'wifi-qr-scanner', 'lorem-ipsum-generator', 'word-counter', 'online-notepad', 'small-text-generator', 'rot13', 'morse-code-translator', 'runic-translator', 'invisible-character-generator', 'reverse-image-search', 'image-to-text', 'internet-speed-test', 'name-checker', 'bin-checker', 'credit-card-checker', 'minecraft-color-codes', 'multi-url-opener', 'binary-translator', 'text-to-binary', 'md5-generator', 'base64-generator', 'password-encryption', 'random-password-generator', 'password-strength-checker'),
        );
        foreach ($extra as $category => $slugs) {
            if (in_array($slug, $slugs, true) && !in_array($category, $categories, true)) { $categories[] = $category; }
        }
        $published = self::discovery();
        return array_values(array_filter($categories, function ($category) use ($published) {
            return isset($published[$category]);
        }));
    }

    /** Every enabled tool published under a discovery category, in catalogue order. */
    public static function toolsInDiscovery($category)
    {
        $published = self::discovery();
        if (!isset($published[$category])) { return null; }
        return array_values(array_filter(self::enabledTools(), function ($tool) use ($category) {
            return in_array($category, self::discoveryCategories($tool), true);
        }));
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
            // Published category URLs use the discovery taxonomy; the catalogue's engine grouping
            // is accepted as well so the older URLs keep resolving instead of turning into 404s.
            $discovery = self::discovery();
            if (isset($discovery[$match[1]])) {
                return array(
                    'kind' => 'category',
                    'path' => $path,
                    'slug' => $match[1],
                    'name' => $discovery[$match[1]] . ' Tools',
                    'summary' => 'CloudHost247 ' . $discovery[$match[1]] . ' tools, each with its own page and an explicit limitation.',
                );
            }
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
