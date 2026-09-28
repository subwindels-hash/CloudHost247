<?php
namespace CloudHost247\Integrations\Security;

use RuntimeException;

/**
 * Resolves the deployment master key used to encrypt integration credentials.
 *
 * The key material is never stored in the repository, in the database or in any
 * web-accessible file. It is read from deployment configuration only:
 *
 *   1. environment variable  CH247_INTEGRATIONS_KEY
 *   2. configuration.php     $ch247_integrations_key
 *
 * If neither is present the vault fails closed: credentials cannot be stored or
 * read, and the dashboard reports a configuration error. There is deliberately
 * no weak fallback key.
 */
final class MasterKey
{
    const ENV_VARIABLE = 'CH247_INTEGRATIONS_KEY';
    const GLOBAL_VARIABLE = 'ch247_integrations_key';
    const INFO = 'cloudhost247-integration-secret-v1';
    const MINIMUM_ENTROPY_BYTES = 32;

    private static $cache = null;

    public static function available()
    {
        try { self::material(); return true; } catch (RuntimeException $e) { return false; }
    }

    /** @return string 32 raw bytes derived from the deployment key material. */
    public static function material()
    {
        if (self::$cache !== null) { return self::$cache; }
        $raw = self::locate();
        if ($raw === null) {
            throw new RuntimeException('Integration credential encryption is not configured on this deployment.');
        }
        $decoded = self::decode($raw);
        if (strlen($decoded) < self::MINIMUM_ENTROPY_BYTES) {
            throw new RuntimeException('The configured integration encryption key is too short.');
        }
        if (!function_exists('hash_hkdf')) {
            throw new RuntimeException('hash_hkdf() is required for integration credential encryption.');
        }
        return self::$cache = hash_hkdf('sha256', $decoded, 32, self::INFO);
    }

    /** Stable, non-reversible identifier of the active key. */
    public static function fingerprint()
    {
        return substr(hash_hmac('sha256', 'cloudhost247-key-fingerprint', self::material()), 0, 16);
    }

    /** Forget cached key material (used after a deployment key rotation). */
    public static function forget()
    {
        self::$cache = null;
    }

    public static function describeSource()
    {
        if (self::fromEnvVariable() !== null) { return 'environment variable ' . self::ENV_VARIABLE; }
        if (self::fromGlobal() !== null) { return 'configuration.php $' . self::GLOBAL_VARIABLE; }
        return 'not configured';
    }

    private static function locate()
    {
        $value = self::fromEnvVariable();
        if ($value === null) { $value = self::fromGlobal(); }
        return $value;
    }

    private static function fromEnvVariable()
    {
        $value = getenv(self::ENV_VARIABLE);
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    private static function fromGlobal()
    {
        if (!isset($GLOBALS[self::GLOBAL_VARIABLE])) { return null; }
        $value = $GLOBALS[self::GLOBAL_VARIABLE];
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /** Accept base64, hex or raw pass-phrase key material. */
    private static function decode($raw)
    {
        if (preg_match('/^[A-Fa-f0-9]{64,}$/', $raw)) {
            $hex = hex2bin($raw);
            if ($hex !== false) { return $hex; }
        }
        if (preg_match('#^[A-Za-z0-9+/]{40,}={0,2}$#', $raw)) {
            $decoded = base64_decode($raw, true);
            if ($decoded !== false && strlen($decoded) >= self::MINIMUM_ENTROPY_BYTES) { return $decoded; }
        }
        return $raw;
    }
}
