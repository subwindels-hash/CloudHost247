<?php
/**
 * Configuration Manager
 *
 * Single source of truth for module settings. Reads from the module settings
 * table first (runtime, editable in the Super Admin panel) and falls back to
 * the WHMCS addon configuration (tbladdonmodules) so the activation defaults
 * still apply. Secret values are transparently encrypted at rest.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

class Config
{
    const TABLE = 'mod_phoneservices_settings';

    /** Settings treated as secrets: encrypted at rest, masked in the UI. */
    const SECRET_SUFFIXES = ['_key', '_token', '_secret', '_sid', '_password', '_signature'];

    /** @var array<string,mixed> */
    private static $cache = [];

    /** @var bool */
    private static $loaded = false;

    /**
     * Get a configuration value (decrypted when it is a secret).
     *
     * @param  mixed $default
     * @return mixed
     */
    public static function get(string $key, $default = null)
    {
        self::loadAll();

        if (array_key_exists($key, self::$cache)) {
            $value = self::$cache[$key];
            return ($value === null || $value === '') && $default !== null ? $default : $value;
        }

        // Fallback: WHMCS addon module configuration fields.
        $value = Database::value('tbladdonmodules', 'value', [
            'module'  => 'phoneservices',
            'setting' => $key,
        ]);

        if ($value === null) {
            self::$cache[$key] = $default;
            return $default;
        }

        $value = self::isSecret($key) ? Crypto::decrypt((string) $value) : $value;
        self::$cache[$key] = $value;

        return $value === '' && $default !== null ? $default : $value;
    }

    public static function getInt(string $key, int $default = 0): int
    {
        $value = self::get($key, $default);

        return is_numeric($value) ? (int) $value : $default;
    }

    public static function getFloat(string $key, float $default = 0.0): float
    {
        $value = self::get($key, $default);

        return is_numeric($value) ? (float) $value : $default;
    }

    public static function getBool(string $key, bool $default = false): bool
    {
        $value = self::get($key, $default ? '1' : '0');

        return in_array(strtolower((string) $value), ['1', 'on', 'yes', 'true'], true);
    }

    /**
     * Persist a configuration value (encrypting secrets).
     *
     * @param mixed $value
     */
    public static function set(string $key, $value): bool
    {
        $stored = self::isSecret($key) ? Crypto::encrypt((string) $value) : (string) $value;

        $exists = Database::value(self::TABLE, 'id', ['setting_name' => $key]);

        if ($exists !== null) {
            Database::update(self::TABLE, [
                'setting_value' => $stored,
                'updated_at'    => date('Y-m-d H:i:s'),
            ], ['setting_name' => $key]);
        } else {
            Database::insert(self::TABLE, [
                'setting_name'  => $key,
                'setting_value' => $stored,
                'created_at'    => date('Y-m-d H:i:s'),
                'updated_at'    => date('Y-m-d H:i:s'),
            ]);
        }

        self::$cache[$key] = self::isSecret($key) ? (string) $value : (string) $value;

        return true;
    }

    /**
     * Bulk set (used by the admin settings forms).
     *
     * @param array<string,mixed> $values
     */
    public static function setMany(array $values): void
    {
        foreach ($values as $key => $value) {
            self::set((string) $key, $value);
        }
    }

    /**
     * Is this setting a secret (encrypted at rest, masked in the UI)?
     */
    public static function isSecret(string $key): bool
    {
        foreach (self::SECRET_SUFFIXES as $suffix) {
            if (substr($key, -strlen($suffix)) === $suffix) {
                return true;
            }
        }

        return false;
    }

    /**
     * Masked value for safe display in the admin panel.
     */
    public static function masked(string $key): string
    {
        return Crypto::mask((string) self::get($key, ''));
    }

    /**
     * Service feature toggles - services can be enabled/disabled dynamically.
     *
     * @return array<string,bool>
     */
    public static function getFeatureToggles(): array
    {
        return [
            'numbers'   => self::getBool('enable_numbers', true),
            'voip'      => self::getBool('enable_voip', true),
            'sms'       => self::getBool('enable_sms', true),
            'esim'      => self::getBool('enable_esim', true),
            'analytics' => self::getBool('enable_analytics', true),
        ];
    }

    public static function isServiceEnabled(string $service): bool
    {
        $toggles = self::getFeatureToggles();

        return $toggles[$service] ?? false;
    }

    /**
     * Credential bag for a provider.
     *
     * The key map is provider-declared (see ProviderRegistry) so adding a new
     * provider never requires editing this class.
     *
     * @return array<string,string>
     */
    public static function getProviderCredentials(string $provider): array
    {
        $credentials = [];

        foreach (\PhoneServices\Providers\ProviderRegistry::credentialFields($provider) as $field) {
            $credentials[$field] = (string) self::get($provider . '_' . $field, '');
        }

        $credentials['mode'] = self::get('api_mode', 'sandbox');
        $credentials['provider'] = $provider;

        return $credentials;
    }

    /**
     * Which provider handles a given capability (sms, voice, numbers, esim,
     * whatsapp, email). Falls back to the platform default provider.
     */
    public static function getProviderForCapability(string $capability): string
    {
        $configured = (string) self::get('provider_' . $capability, '');

        if ($configured !== '') {
            return $configured;
        }

        return (string) self::get('default_provider', 'twilio');
    }

    public static function isSandbox(): bool
    {
        return self::get('api_mode', 'sandbox') !== 'live';
    }

    /**
     * Base URL used to build webhook callbacks handed to providers.
     */
    public static function webhookBaseUrl(): string
    {
        $configured = rtrim((string) self::get('webhook_base_url', ''), '/');
        if ($configured !== '') {
            return $configured;
        }

        $systemUrl = '';

        try {
            if (class_exists('\\WHMCS\\Config\\Setting')) {
                $systemUrl = (string) \WHMCS\Config\Setting::getValue('SystemURL');
            }
        } catch (\Exception $e) {
            $systemUrl = '';
        }

        return rtrim($systemUrl, '/') . '/modules/addons/phoneservices/api/webhooks';
    }

    /**
     * Load every runtime setting once per request.
     */
    private static function loadAll(): void
    {
        if (self::$loaded) {
            return;
        }

        self::$loaded = true;

        foreach (Database::select(self::TABLE, '*', [], 'id', 'ASC') as $row) {
            $name = $row['setting_name'] ?? '';
            if ($name === '') {
                continue;
            }

            $value = (string) ($row['setting_value'] ?? '');
            self::$cache[$name] = self::isSecret($name) ? Crypto::decrypt($value) : $value;
        }
    }

    public static function clearCache(): void
    {
        self::$cache = [];
        self::$loaded = false;
    }

    /**
     * Test seam: preload settings without touching the database.
     *
     * @param array<string,mixed> $values
     */
    public static function seed(array $values): void
    {
        self::$cache = $values;
        self::$loaded = true;
    }
}
