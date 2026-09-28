<?php
/**
 * Module settings.
 *
 * Settings live in mod_customaffiliate_settings so that they can be edited from
 * the module's own admin page (with a real product-group picker) rather than
 * being limited to the static field types available in tbladdonmodules.
 *
 * Values from the legacy 1.x addon configuration are imported on activation,
 * and tbladdonmodules is still consulted as a read-only fallback so that an
 * upgrade can never leave the module unconfigured.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class Settings
{
    const TABLE = 'mod_customaffiliate_settings';

    /**
     * Defaults. These are also the values seeded on activation.
     *
     * @var array<string,string>
     */
    const DEFAULTS = [
        // Master switch. When off, the module keeps recording nothing and
        // leaves WHMCS's own affiliate behaviour completely untouched.
        'enabled'                      => '1',

        // Comma separated tblproductgroups.id values treated as "Web Hosting".
        'product_group_ids'            => '',

        // Commission rates, in percent.
        'first_commission_percent'     => '50',
        'recurring_commission_percent' => '20',

        // Exclusive mode: suppress WHMCS's built-in commission calculation so
        // that this module is the only thing that ever pays an affiliate.
        // This is what excludes domains, RDP, SSL, email hosting, etc.
        'exclusive_mode'               => '1',

        // Only pay the (higher) first-payment rate when the referred client was
        // new at the time of the order. Existing clients earn the recurring
        // rate from their first payment onwards.
        'require_new_client'           => '1',

        // Blank = inherit the WHMCS "Affiliate Commission Delay" setting.
        'commission_delay_days'        => '',

        // Spread invoice level discounts (promotions, credit line items) across
        // the commissionable line items before applying the rate.
        'apply_discounts'              => '1',

        // Commission reversal behaviour.
        'reverse_on_refund'            => '1',
        'reverse_on_cancel'            => '1',

        // Ignore line items below this amount (guards against $0.00 and
        // rounding-noise renewals).
        'minimum_base_amount'          => '0.01',

        'debug_logging'                => '0',
    ];

    /** @var array<string,string>|null */
    private static $cache;

    /** @var array<string,string>|null */
    private static $legacy;

    /**
     * Read a single setting.
     *
     * @param  mixed $default
     * @return mixed
     */
    public static function get(string $name, $default = null)
    {
        $all = self::all();

        if (array_key_exists($name, $all) && $all[$name] !== '') {
            return $all[$name];
        }

        // Fall back to the legacy tbladdonmodules configuration, then to the
        // documented default.
        $legacy = self::legacy();
        $legacyKey = self::legacyKey($name);

        if ($legacyKey !== null && isset($legacy[$legacyKey]) && $legacy[$legacyKey] !== '') {
            return $legacy[$legacyKey];
        }

        if ($default !== null) {
            return $default;
        }

        return self::DEFAULTS[$name] ?? null;
    }

    public static function getInt(string $name, int $default = 0): int
    {
        $value = self::get($name);

        return $value === null || $value === '' ? $default : (int) $value;
    }

    public static function getFloat(string $name, float $default = 0.0): float
    {
        $value = self::get($name);

        return $value === null || $value === '' ? $default : (float) $value;
    }

    public static function getBool(string $name, bool $default = false): bool
    {
        $value = self::get($name);

        if ($value === null || $value === '') {
            return $default;
        }

        return in_array(strtolower((string) $value), ['1', 'on', 'yes', 'true'], true);
    }

    /**
     * Persist a setting.
     */
    public static function set(string $name, $value): void
    {
        $value = is_array($value) ? implode(',', $value) : (string) $value;

        try {
            $exists = Capsule::table(self::TABLE)->where('setting_name', $name)->exists();

            if ($exists) {
                Capsule::table(self::TABLE)
                    ->where('setting_name', $name)
                    ->update(['setting_value' => $value, 'updated_at' => date('Y-m-d H:i:s')]);
            } else {
                Capsule::table(self::TABLE)->insert([
                    'setting_name'  => $name,
                    'setting_value' => $value,
                    'updated_at'    => date('Y-m-d H:i:s'),
                ]);
            }

            self::$cache[$name] = $value;
        } catch (\Throwable $e) {
            Logger::error('Failed to save setting ' . $name, ['error' => $e->getMessage()]);
        }
    }

    /**
     * @param array<string,mixed> $values
     */
    public static function setMany(array $values): void
    {
        foreach ($values as $name => $value) {
            self::set($name, $value);
        }
    }

    /**
     * All stored settings merged over the defaults.
     *
     * @return array<string,string>
     */
    public static function all(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        $stored = [];

        try {
            foreach (Capsule::table(self::TABLE)->get() as $row) {
                $stored[(string) $row->setting_name] = (string) $row->setting_value;
            }
        } catch (\Throwable $e) {
            // Table missing (module not activated yet): defaults still apply.
            $stored = [];
        }

        self::$cache = array_merge(self::DEFAULTS, $stored);

        return self::$cache;
    }

    public static function clearCache(): void
    {
        self::$cache = null;
        self::$legacy = null;
    }

    /* ==================================================================
     | Typed accessors used by the engine
     * ================================================================= */

    public static function isEnabled(): bool
    {
        return self::getBool('enabled', true);
    }

    public static function isExclusive(): bool
    {
        return self::getBool('exclusive_mode', true);
    }

    public static function requiresNewClient(): bool
    {
        return self::getBool('require_new_client', true);
    }

    /**
     * Product groups that earn commission.
     *
     * @return array<int,int>
     */
    public static function productGroupIds(): array
    {
        return self::parseGroupIds((string) self::get('product_group_ids', ''));
    }

    /**
     * Parse a CSV of group ids into a clean, unique, positive int list.
     *
     * Pure helper so the parsing rules can be unit tested.
     *
     * @return array<int,int>
     */
    public static function parseGroupIds(string $csv): array
    {
        $ids = [];

        foreach (preg_split('/[^0-9]+/', $csv) ?: [] as $chunk) {
            $id = (int) $chunk;

            if ($id > 0) {
                $ids[$id] = $id;
            }
        }

        return array_values($ids);
    }

    /**
     * Clamp a percentage into a sane range (0-100 inclusive).
     *
     * Pure helper: the admin form and the engine both use it.
     */
    public static function normaliseRate($value, float $default): float
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return $default;
        }

        return round(max(0.0, min(100.0, (float) $value)), 3);
    }

    public static function firstRate(): float
    {
        return self::normaliseRate(self::get('first_commission_percent'), 50.0);
    }

    public static function recurringRate(): float
    {
        return self::normaliseRate(self::get('recurring_commission_percent'), 20.0);
    }

    public static function minimumBaseAmount(): float
    {
        return max(0.0, self::getFloat('minimum_base_amount', 0.01));
    }

    public static function appliesDiscounts(): bool
    {
        return self::getBool('apply_discounts', true);
    }

    public static function reversesOnRefund(): bool
    {
        return self::getBool('reverse_on_refund', true);
    }

    public static function reversesOnCancel(): bool
    {
        return self::getBool('reverse_on_cancel', true);
    }

    /**
     * Commission delay in days. Falls back to the WHMCS "Affiliate Commission
     * Delay" general setting so the module behaves like the rest of the
     * affiliate system unless explicitly overridden.
     */
    public static function commissionDelayDays(): int
    {
        $own = (string) self::get('commission_delay_days', '');

        if ($own !== '' && is_numeric($own)) {
            return max(0, (int) $own);
        }

        try {
            $value = Capsule::table('tblconfiguration')
                ->where('setting', 'AffiliateDelay')
                ->value('value');

            return max(0, (int) $value);
        } catch (\Throwable $e) {
            return 0;
        }
    }

    public static function debugLogging(): bool
    {
        return self::getBool('debug_logging', false);
    }

    /* ==================================================================
     | Legacy 1.x configuration
     * ================================================================= */

    /**
     * Map a 2.x setting name onto its 1.x tbladdonmodules equivalent.
     */
    private static function legacyKey(string $name): ?string
    {
        $map = [
            'product_group_ids'            => 'product_group_id',
            'first_commission_percent'     => 'first_commission_percent',
            'recurring_commission_percent' => 'recurring_commission_percent',
            'debug_logging'                => 'enable_logging',
        ];

        return $map[$name] ?? null;
    }

    /**
     * @return array<string,string>
     */
    public static function legacy(): array
    {
        if (self::$legacy !== null) {
            return self::$legacy;
        }

        self::$legacy = [];

        try {
            foreach (Capsule::table('tbladdonmodules')->where('module', CUSTOMAFFILIATE_MODULE)->get() as $row) {
                self::$legacy[(string) $row->setting] = (string) $row->value;
            }
        } catch (\Throwable $e) {
            self::$legacy = [];
        }

        return self::$legacy;
    }
}
