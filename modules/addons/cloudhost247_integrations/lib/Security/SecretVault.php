<?php
namespace CloudHost247\Integrations\Security;

use RuntimeException;

/**
 * Authenticated envelope encryption for integration credentials.
 *
 * Format: v1.<base64 iv>.<base64 tag>.<base64 ciphertext>
 *
 * - AES-256-GCM with a random 12-byte IV per write.
 * - Additional authenticated data binds a ciphertext to one integration row and
 *   one field, so a stored value cannot be replayed into a different provider,
 *   environment or credential slot.
 * - Decryption happens on the server only, at the moment an outbound API call
 *   or connection test needs the value. Plaintext is never persisted, never
 *   rendered, never logged and never returned by any admin response.
 */
final class SecretVault
{
    const CIPHER = 'aes-256-gcm';
    const VERSION = 'v1';
    const IV_BYTES = 12;
    const TAG_BYTES = 16;
    const MAX_PLAINTEXT = 8192;

    public static function available()
    {
        return extension_loaded('openssl')
            && in_array(self::CIPHER, openssl_get_cipher_methods(), true)
            && MasterKey::available();
    }

    public static function encrypt($plaintext, array $context)
    {
        $plaintext = (string) $plaintext;
        if ($plaintext === '') { throw new RuntimeException('Refusing to store an empty credential.'); }
        if (strlen($plaintext) > self::MAX_PLAINTEXT) { throw new RuntimeException('Credential exceeds the supported length.'); }
        self::assertCipher();
        $iv = random_bytes(self::IV_BYTES);
        $tag = '';
        $cipherText = openssl_encrypt($plaintext, self::CIPHER, MasterKey::material(), OPENSSL_RAW_DATA, $iv, $tag, self::aad($context), self::TAG_BYTES);
        if ($cipherText === false || strlen($tag) !== self::TAG_BYTES) {
            throw new RuntimeException('Credential encryption failed.');
        }
        return self::VERSION . '.' . base64_encode($iv) . '.' . base64_encode($tag) . '.' . base64_encode($cipherText);
    }

    public static function decrypt($envelope, array $context)
    {
        self::assertCipher();
        $parts = explode('.', (string) $envelope);
        if (count($parts) !== 4 || $parts[0] !== self::VERSION) {
            throw new RuntimeException('Stored credential envelope is not readable.');
        }
        $iv = base64_decode($parts[1], true);
        $tag = base64_decode($parts[2], true);
        $cipherText = base64_decode($parts[3], true);
        if ($iv === false || $tag === false || $cipherText === false || strlen($iv) !== self::IV_BYTES || strlen($tag) !== self::TAG_BYTES) {
            throw new RuntimeException('Stored credential envelope is not readable.');
        }
        $plaintext = openssl_decrypt($cipherText, self::CIPHER, MasterKey::material(), OPENSSL_RAW_DATA, $iv, $tag, self::aad($context));
        if ($plaintext === false) {
            throw new RuntimeException('Stored credential could not be authenticated with the configured key.');
        }
        return $plaintext;
    }

    /**
     * Non-reversible identifier of a credential value, keyed with the master
     * key so that the same secret produces the same fingerprint on this
     * deployment only. Used for masked display and rotation confirmation.
     */
    public static function fingerprintValue($plaintext)
    {
        return substr(hash_hmac('sha256', 'cloudhost247-secret-fingerprint|' . (string) $plaintext, MasterKey::material()), 0, 16);
    }

    private static function aad(array $context)
    {
        $integrationId = isset($context['integration_id']) ? (int) $context['integration_id'] : 0;
        $fieldKey = isset($context['field_key']) ? (string) $context['field_key'] : '';
        if ($integrationId <= 0 || !preg_match('/^[a-z0-9_]{1,64}$/', $fieldKey)) {
            throw new RuntimeException('Credential storage context is incomplete.');
        }
        return 'cloudhost247|' . $integrationId . '|' . $fieldKey . '|' . MasterKey::fingerprint();
    }

    private static function assertCipher()
    {
        if (!extension_loaded('openssl') || !in_array(self::CIPHER, openssl_get_cipher_methods(), true)) {
            throw new RuntimeException('OpenSSL AES-256-GCM is required for integration credential storage.');
        }
    }
}
