<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Render\StyleCompiler;
use CloudHost247\Builder\Repositories\LibraryRepository;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\CssSanitizer;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\UrlPolicy;

/**
 * Builder settings, global styles, SEO defaults and custom CSS.
 *
 * Every setting has a declared type and is validated on write, so the settings
 * table cannot become a way to smuggle markup or CSS onto a page. Custom CSS
 * gets the strictest treatment: it is the only free-form value here and it is
 * filtered by CssSanitizer and gated behind its own capability.
 */
class Settings
{
    const DEFAULTS = array(
        'site_title' => 'CloudHost247',
        'seo_title_suffix' => ' | CloudHost247',
        'seo_default_description' => '',
        'seo_default_robots' => 'index,follow',
        'social_image_url' => '',
        'revision_limit' => '30',
        'autosave_seconds' => '45',
        'preview_ttl_minutes' => '30',
        'media_max_mib' => '12',
        'form_rate_limit' => '5',
        'public_base_path' => 'builder-page.php',
        'pretty_urls' => '0',
        'custom_css' => '',
        'global_styles' => '',
    );

    /** Settings an administrator may change, with their validator. */
    const TYPES = array(
        'site_title' => 'text', 'seo_title_suffix' => 'text', 'seo_default_description' => 'text',
        'seo_default_robots' => 'robots', 'social_image_url' => 'url',
        'revision_limit' => 'int:5:200', 'autosave_seconds' => 'int:15:600',
        'preview_ttl_minutes' => 'int:5:1440', 'media_max_mib' => 'int:1:256',
        'form_rate_limit' => 'int:1:60', 'public_base_path' => 'path', 'pretty_urls' => 'bool',
        'custom_css' => 'css', 'global_styles' => 'json',
    );

    const ROBOTS = array('index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow');

    private $library;
    private $sanitizer;
    private $cache = null;

    public function __construct(LibraryRepository $library = null, HtmlSanitizer $sanitizer = null)
    {
        $this->library = $library ? $library : new LibraryRepository();
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
    }

    public function all()
    {
        if ($this->cache !== null) { return $this->cache; }
        $stored = $this->library->settings();
        $settings = self::DEFAULTS;
        foreach ($stored as $key => $value) {
            if (array_key_exists($key, $settings)) { $settings[$key] = (string) $value; }
        }
        $this->cache = $settings;
        return $settings;
    }

    public function get($key, $default = null)
    {
        $settings = $this->all();
        if (array_key_exists($key, $settings)) { return $settings[$key]; }
        return $default === null && isset(self::DEFAULTS[$key]) ? self::DEFAULTS[$key] : $default;
    }

    public function integer($key)
    {
        return (int) $this->get($key, isset(self::DEFAULTS[$key]) ? self::DEFAULTS[$key] : 0);
    }

    public function flag($key)
    {
        return $this->get($key, '0') === '1';
    }

    /**
     * Validate and persist a set of settings.
     *
     * @return array the keys actually changed
     */
    public function save(array $input, $adminId, array $allowedKeys = null)
    {
        $changed = array();
        foreach (self::TYPES as $key => $type) {
            if (!array_key_exists($key, $input)) { continue; }
            if ($allowedKeys !== null && !in_array($key, $allowedKeys, true)) { continue; }
            $value = $this->coerce($key, $type, $input[$key]);
            if ($value === $this->get($key)) { continue; }
            $this->library->saveSetting($key, $value, $adminId);
            $changed[] = $key;
        }
        $this->cache = null;
        return $changed;
    }

    private function coerce($key, $type, $value)
    {
        if (strncmp($type, 'int:', 4) === 0) {
            list(, $min, $max) = explode(':', $type);
            $number = (int) $value;
            if ($number < (int) $min || $number > (int) $max) {
                throw BuilderException::validation(str_replace('_', ' ', $key) . ' must be between ' . $min . ' and ' . $max . '.');
            }
            return (string) $number;
        }
        switch ($type) {
            case 'bool':
                return empty($value) || $value === '0' ? '0' : '1';
            case 'robots':
                return in_array($value, self::ROBOTS, true) ? (string) $value : 'index,follow';
            case 'url':
                $url = UrlPolicy::media(is_scalar($value) ? (string) $value : '');
                if ($url === null) { throw BuilderException::validation('The social image URL is not acceptable.'); }
                return (string) $url;
            case 'path':
                $path = trim((string) $value);
                if (preg_match('#^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$#', $path) !== 1) {
                    throw BuilderException::validation('The public page path must be a simple relative path such as builder-page.php.');
                }
                return $path;
            case 'css':
                $sanitizer = new CssSanitizer();
                return $sanitizer->clean(is_scalar($value) ? (string) $value : '');
            case 'json':
                return $this->encodeGlobalStyles($value);
            default:
                return $this->sanitizer->text(is_scalar($value) ? (string) $value : '', 300);
        }
    }

    /* -------------------------------------------------------- global styles */

    /** Stored palette and typography, merged over the compiler defaults. */
    public function globalStyles()
    {
        $decoded = json_decode((string) $this->get('global_styles', ''), true);
        $styles = array();
        if (is_array($decoded)) {
            foreach ($decoded as $name => $value) {
                if (isset(StyleCompiler::DEFAULT_VARIABLES[$name])) { $styles[$name] = (string) $value; }
            }
        }
        return $styles;
    }

    public function compiler()
    {
        return new StyleCompiler($this->globalStyles());
    }

    /** Effective values shown in the Global Styles screen. */
    public function effectiveStyles()
    {
        return $this->compiler()->variables();
    }

    private function encodeGlobalStyles($value)
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = is_array($decoded) ? $decoded : array();
        }
        if (!is_array($value)) { return ''; }
        // Round-trip through the compiler so only values it can emit survive.
        $compiler = new StyleCompiler($value);
        $clean = array();
        foreach ($compiler->variables() as $name => $resolved) {
            if (!isset($value[$name])) { continue; }
            $clean[$name] = $resolved;
        }
        return $clean ? (string) json_encode($clean) : '';
    }
}
