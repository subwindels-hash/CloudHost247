<?php
namespace CloudHost247\Integrations\Registry;

use InvalidArgumentException;

/**
 * Central integration registry.
 *
 * Integration -> Provider -> Credentials -> Configuration -> Health Check -> API Client
 *
 * Every part of the platform resolves providers through this registry. A new
 * provider becomes available across the dashboard, the health overview, the
 * connection tester and the runtime client factory by registering one
 * ProviderDefinition; nothing else has to change.
 */
final class ProviderRegistry
{
    /** Category keys used to group the dashboard. */
    private static $categories = array(
        'rdp' => 'RDP / Remote desktop',
        'hosting' => 'Hosting & server provisioning',
        'control_panel' => 'WHM / cPanel control panels',
        'domains' => 'Domain registrars',
        'dns' => 'DNS',
        'cdn' => 'Cloudflare / edge',
        'payments' => 'Payments',
        'email' => 'Email & SMTP',
        'sms' => 'SMS',
        'whatsapp' => 'WhatsApp',
        'telegram' => 'Telegram',
        'ai' => 'AI / LLM',
        'storage' => 'Storage',
        'monitoring' => 'Monitoring',
        'verification' => 'Verification / KYC',
        'notifications' => 'Notifications',
        'exchange_rates' => 'Exchange rates',
        'network' => 'Network & proxy',
        'social' => 'Social media / SMM',
    );

    private static $definitions = null;
    private static $extra = array();

    /**
     * Register an additional provider at runtime (for example from a future
     * module's bootstrap). Registration is additive and never replaces a
     * built-in definition silently.
     */
    public static function register(ProviderDefinition $definition, $replace = false)
    {
        self::load();
        $key = $definition->key();
        if (!$replace && isset(self::$definitions[$key])) {
            throw new InvalidArgumentException('Provider "' . $key . '" is already registered.');
        }
        self::$definitions[$key] = $definition;
        self::$extra[$key] = true;
        return $definition;
    }

    /** @return ProviderDefinition[] keyed by provider key */
    public static function all()
    {
        self::load();
        return self::$definitions;
    }

    public static function has($key)
    {
        self::load();
        return is_string($key) && isset(self::$definitions[$key]);
    }

    /** @return ProviderDefinition */
    public static function get($key)
    {
        self::load();
        if (!is_string($key) || !isset(self::$definitions[$key])) {
            throw new InvalidArgumentException('Unknown integration provider.');
        }
        return self::$definitions[$key];
    }

    /** @return ProviderDefinition[] */
    public static function byCategory($category)
    {
        $matches = array();
        foreach (self::all() as $key => $definition) {
            if ($definition->category() === $category) { $matches[$key] = $definition; }
        }
        return $matches;
    }

    /** @return ProviderDefinition[] grouped by category key, in display order */
    public static function grouped()
    {
        $grouped = array();
        foreach (array_keys(self::$categories) as $category) {
            $providers = self::byCategory($category);
            if ($providers) { $grouped[$category] = $providers; }
        }
        foreach (self::all() as $key => $definition) {
            $category = $definition->category();
            if (!isset(self::$categories[$category])) { $grouped[$category][$key] = $definition; }
        }
        return $grouped;
    }

    public static function categories()
    {
        return self::$categories;
    }

    public static function categoryLabel($category)
    {
        return isset(self::$categories[$category]) ? self::$categories[$category] : ucwords(str_replace('_', ' ', (string) $category));
    }

    /** Reset the registry (test support only). */
    public static function reset()
    {
        self::$definitions = null;
        self::$extra = array();
    }

    private static function load()
    {
        if (self::$definitions !== null) { return; }
        self::$definitions = array();
        foreach (ProviderCatalog::definitions() as $definition) {
            self::$definitions[$definition->key()] = $definition;
        }
    }
}
