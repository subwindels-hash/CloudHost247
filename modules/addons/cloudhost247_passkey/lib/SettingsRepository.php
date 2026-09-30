<?php
/**
 * Key/value settings for the Passkey addon, following the convention already
 * used by cloudhost247_marketing and cloudhost247_cart_recovery rather than
 * introducing another configuration mechanism.
 *
 * Secrets (currently only the Microsoft Entra ID client secret) are stored
 * encrypted at rest through the Foundation SecretPolicy/WHMCS encryption
 * helper and are never returned by all() — they are read through
 * secret() by the single service that needs them.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class SettingsRepository
{
    /** @var array|null in-request cache */
    private static $cache = null;

    /** Setting keys whose value is encrypted at rest and never logged/echoed. */
    public static function secretKeys()
    {
        return array('entra_client_secret');
    }

    public static function defaults()
    {
        return array(
            // --- master switch -------------------------------------------------------------
            'enabled' => '1',

            // --- WebAuthn relying party (spec §16) -----------------------------------------
            // Empty by design: an unconfigured deployment must fail closed with
            // CONFIGURATION_REQUIRED rather than guess a development domain.
            'rp_name' => '',
            'rp_id' => '',
            'allowed_origins' => '',
            'environment' => 'production',
            'require_https' => '1',

            // --- policy (spec §9) ----------------------------------------------------------
            'client_policy' => Schema::ENFORCE_OPTIONAL,
            'admin_policy' => Schema::ENFORCE_OPTIONAL,
            'password_fallback' => '1',
            'max_credentials_client' => '5',
            'max_credentials_admin' => '5',
            'user_verification' => 'preferred',
            'action_user_verification' => 'required',
            'resident_key' => 'preferred',

            // --- ceremony hardening --------------------------------------------------------
            'challenge_ttl' => '120',           // seconds
            'action_challenge_ttl' => '90',
            'reset_authorization_ttl' => '600',
            'rate_limit_window' => '300',
            'rate_limit_attempts' => '10',
            'lockout_seconds' => '900',

            // --- features -------------------------------------------------------------------
            'sensitive_action_confirmation' => '1',
            'password_reset_enabled' => '1',
            'reset_invalidates_sessions' => '1',
            'login_notifications_client' => '1',
            'login_notifications_admin' => '1',
            'security_notifications' => '1',
            'event_retention_days' => '365',

            // --- Microsoft Entra ID (optional, spec §22) -------------------------------------
            'entra_enabled' => '0',
            'entra_tenant_id' => '',
            'entra_client_id' => '',
            'entra_client_secret' => '',
            'entra_redirect_uri' => '',
            'entra_allowed_domains' => '',
            'entra_client_login' => '0',
            'entra_admin_login' => '0',
        );
    }

    public static function boolKeys()
    {
        return array(
            'enabled', 'require_https', 'password_fallback', 'sensitive_action_confirmation',
            'password_reset_enabled', 'reset_invalidates_sessions', 'login_notifications_client',
            'login_notifications_admin', 'security_notifications', 'entra_enabled',
            'entra_client_login', 'entra_admin_login',
        );
    }

    /** key => [min, max] */
    public static function intKeys()
    {
        return array(
            'max_credentials_client' => array(1, 100),
            'max_credentials_admin' => array(1, 100),
            'challenge_ttl' => array(30, 600),
            'action_challenge_ttl' => array(30, 600),
            'reset_authorization_ttl' => array(60, 3600),
            'rate_limit_window' => array(60, 3600),
            'rate_limit_attempts' => array(3, 100),
            'lockout_seconds' => array(60, 86400),
            'event_retention_days' => array(30, 3650),
        );
    }

    /** key => allowed values */
    public static function enumKeys()
    {
        return array(
            'client_policy' => Schema::enforcementPolicies(),
            'admin_policy' => Schema::enforcementPolicies(),
            'environment' => array('production', 'staging', 'development'),
            'user_verification' => array('preferred', 'required', 'discouraged'),
            'action_user_verification' => array('preferred', 'required'),
            'resident_key' => array('preferred', 'required', 'discouraged'),
        );
    }

    public static function all()
    {
        if (self::$cache !== null) {
            return self::$cache;
        }
        $values = self::defaults();
        try {
            if (Capsule::schema()->hasTable(Schema::SETTINGS)) {
                foreach (Capsule::table(Schema::SETTINGS)->get() as $row) {
                    $key = (string) $row->setting_key;
                    if (array_key_exists($key, $values)) {
                        $values[$key] = (string) $row->setting_value;
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('settings.read_failed', array('error' => Log::safeError($e)));
        }
        // Secrets are never part of the general settings array.
        foreach (self::secretKeys() as $secret) {
            $values[$secret] = $values[$secret] === '' ? '' : '********';
        }
        self::$cache = $values;
        return $values;
    }

    public static function get($key, $default = null)
    {
        $all = self::all();
        return array_key_exists($key, $all) ? $all[$key] : $default;
    }

    public static function bool($key)
    {
        return self::get($key, '0') === '1';
    }

    public static function int($key)
    {
        return (int) self::get($key, '0');
    }

    /** Reads and decrypts one secret value. Never cached, never logged. */
    public static function secret($key)
    {
        if (!in_array($key, self::secretKeys(), true)) {
            throw new PasskeyException('Unknown secret key.', 'configuration_required');
        }
        try {
            if (!Capsule::schema()->hasTable(Schema::SETTINGS)) {
                return '';
            }
            $row = Capsule::table(Schema::SETTINGS)->where('setting_key', $key)->first();
            if (!$row || (string) $row->setting_value === '') {
                return '';
            }
            return Crypto::decrypt((string) $row->setting_value);
        } catch (\Throwable $e) {
            Log::error('settings.secret_read_failed', array('key' => $key, 'error' => Log::safeError($e)));
            return '';
        }
    }

    /**
     * Validates and stores a set of values. Unknown keys are ignored (never
     * written blindly), booleans/integers/enums are coerced into range, and
     * secrets are encrypted before they touch the database.
     *
     * @return array the sanitised values that were written
     */
    public static function save(array $input, $adminId = 0)
    {
        $defaults = self::defaults();
        $ints = self::intKeys();
        $enums = self::enumKeys();
        $bools = self::boolKeys();
        $written = array();

        foreach ($input as $key => $value) {
            if (!array_key_exists($key, $defaults)) {
                continue;
            }
            if (in_array($key, self::secretKeys(), true)) {
                $value = (string) $value;
                // An unchanged masked value must not overwrite the stored secret.
                if ($value === '' || $value === '********') {
                    continue;
                }
                $stored = Crypto::encrypt($value);
            } elseif (in_array($key, $bools, true)) {
                $stored = ($value === '1' || $value === 1 || $value === true || $value === 'on') ? '1' : '0';
            } elseif (isset($ints[$key])) {
                list($min, $max) = $ints[$key];
                $stored = (string) max($min, min($max, (int) $value));
            } elseif (isset($enums[$key])) {
                $stored = in_array((string) $value, $enums[$key], true) ? (string) $value : $defaults[$key];
            } elseif ($key === 'allowed_origins' || $key === 'entra_allowed_domains') {
                $stored = Config::normaliseList((string) $value, $key === 'allowed_origins');
            } elseif ($key === 'rp_id') {
                $stored = Config::normaliseRpId((string) $value);
            } else {
                $stored = mb_substr(trim((string) $value), 0, 500);
            }

            self::put($key, $stored);
            $written[$key] = in_array($key, self::secretKeys(), true) ? '[encrypted]' : $stored;
        }

        self::$cache = null;
        Log::info('settings.saved', array('admin_id' => (int) $adminId, 'keys' => array_keys($written)));
        return $written;
    }

    private static function put($key, $value)
    {
        $now = date('Y-m-d H:i:s');
        $existing = Capsule::table(Schema::SETTINGS)->where('setting_key', $key)->first();
        if ($existing) {
            Capsule::table(Schema::SETTINGS)->where('setting_key', $key)
                ->update(array('setting_value' => $value, 'updated_at' => $now));
            return;
        }
        Capsule::table(Schema::SETTINGS)->insert(array(
            'setting_key' => $key,
            'setting_value' => $value,
            'created_at' => $now,
            'updated_at' => $now,
        ));
    }

    /** Writes any missing default row. Safe to run on every activate/upgrade. */
    public static function seed()
    {
        $now = date('Y-m-d H:i:s');
        foreach (self::defaults() as $key => $value) {
            $exists = Capsule::table(Schema::SETTINGS)->where('setting_key', $key)->first();
            if (!$exists) {
                Capsule::table(Schema::SETTINGS)->insert(array(
                    'setting_key' => $key,
                    'setting_value' => (string) $value,
                    'created_at' => $now,
                    'updated_at' => $now,
                ));
            }
        }
        self::$cache = null;
    }

    /** Test seam: forget the in-request cache. */
    public static function flush()
    {
        self::$cache = null;
    }
}
