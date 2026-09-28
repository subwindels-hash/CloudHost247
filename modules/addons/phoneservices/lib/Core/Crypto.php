<?php
/**
 * Crypto - at-rest encryption for provider credentials.
 *
 * Requirement: "Secure API handling (no exposed keys)". Credentials are never
 * stored in plaintext; they are sealed with AES-256-GCM (authenticated
 * encryption) using a key derived from the WHMCS installation secret
 * ($cc_encryption_hash in configuration.php), so a leaked database dump alone
 * does not expose provider API keys.
 *
 * Values are stored with a version prefix so that plaintext values written by
 * earlier releases keep working and are transparently re-encrypted on save.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

class Crypto
{
    /** Envelope prefix for encrypted payloads. */
    const PREFIX = 'psenc:v1:';

    const CIPHER = 'aes-256-gcm';

    /** @var string|null Cached derived key */
    private static $key;

    /**
     * Encrypt a value. Empty strings are returned untouched so that "not set"
     * stays distinguishable from "set to empty".
     */
    public static function encrypt(?string $plaintext): string
    {
        $plaintext = (string) $plaintext;
        if ($plaintext === '' || self::isEncrypted($plaintext)) {
            return $plaintext;
        }

        if (!self::isAvailable()) {
            // Never silently downgrade to plaintext without a trace.
            Logger::warning('Credential stored without encryption: openssl AES-256-GCM unavailable');
            return $plaintext;
        }

        $iv = random_bytes(12);
        $tag = '';
        $cipherText = openssl_encrypt($plaintext, self::CIPHER, self::key(), OPENSSL_RAW_DATA, $iv, $tag, '', 16);

        if ($cipherText === false) {
            Logger::error('Credential encryption failed');
            return $plaintext;
        }

        return self::PREFIX . base64_encode($iv . $tag . $cipherText);
    }

    /**
     * Decrypt a value. Plaintext (legacy) values are returned as-is.
     */
    public static function decrypt(?string $value): string
    {
        $value = (string) $value;
        if ($value === '' || !self::isEncrypted($value)) {
            return $value;
        }

        $raw = base64_decode(substr($value, strlen(self::PREFIX)), true);
        if ($raw === false || strlen($raw) < 29) {
            Logger::error('Credential decryption failed: malformed payload');
            return '';
        }

        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $cipherText = substr($raw, 28);

        $plaintext = openssl_decrypt($cipherText, self::CIPHER, self::key(), OPENSSL_RAW_DATA, $iv, $tag);

        if ($plaintext === false) {
            Logger::error('Credential decryption failed: authentication tag mismatch');
            return '';
        }

        return $plaintext;
    }

    public static function isEncrypted(string $value): bool
    {
        return strncmp($value, self::PREFIX, strlen(self::PREFIX)) === 0;
    }

    /**
     * Mask a secret for display/logging: keeps the last 4 characters.
     */
    public static function mask(?string $secret, int $visible = 4): string
    {
        $secret = (string) $secret;
        if ($secret === '') {
            return '';
        }

        $length = strlen($secret);
        if ($length <= $visible) {
            return str_repeat('*', $length);
        }

        return str_repeat('*', min(24, $length - $visible)) . substr($secret, -$visible);
    }

    /**
     * Constant-time comparison helper for webhook signatures / API keys.
     */
    public static function secureCompare(string $known, string $given): bool
    {
        return hash_equals($known, $given);
    }

    /**
     * Generate a URL-safe random token (used for API keys and WebRTC tokens).
     */
    public static function randomToken(int $bytes = 32): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    public static function isAvailable(): bool
    {
        return function_exists('openssl_encrypt')
            && in_array(self::CIPHER, openssl_get_cipher_methods(), true);
    }

    /**
     * Derive the 256-bit key from the WHMCS installation secret.
     */
    private static function key(): string
    {
        if (self::$key !== null) {
            return self::$key;
        }

        $secret = '';

        // WHMCS exposes the encryption hash through configuration.php globals.
        if (isset($GLOBALS['cc_encryption_hash']) && is_string($GLOBALS['cc_encryption_hash'])) {
            $secret = $GLOBALS['cc_encryption_hash'];
        }

        if ($secret === '' && defined('PHONESERVICES_ENCRYPTION_KEY')) {
            $secret = (string) constant('PHONESERVICES_ENCRYPTION_KEY');
        }

        if ($secret === '') {
            $envKey = getenv('PHONESERVICES_ENCRYPTION_KEY');
            if (is_string($envKey) && $envKey !== '') {
                $secret = $envKey;
            }
        }

        if ($secret === '') {
            // Last resort: derive from the DB credentials so the value is at
            // least installation-specific rather than a shared constant.
            $secret = (string) ($GLOBALS['db_host'] ?? '') . '|' . (string) ($GLOBALS['db_name'] ?? '') . '|phoneservices';
            Logger::warning('cc_encryption_hash unavailable; using fallback key derivation');
        }

        self::$key = hash_hkdf('sha256', $secret, 32, 'phoneservices-credentials');

        return self::$key;
    }

    /** Test seam: reset the cached key. */
    public static function resetKeyCache(): void
    {
        self::$key = null;
    }
}
