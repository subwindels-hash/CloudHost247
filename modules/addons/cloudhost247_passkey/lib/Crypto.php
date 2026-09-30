<?php
/**
 * Encryption for the handful of secrets this addon stores (currently only the
 * Microsoft Entra ID client secret).
 *
 * Preference order:
 *   1. WHMCS's own encryption service (\WHMCS\Input\Sanitize is unrelated;
 *      the encryption helpers `encrypt()` / `decrypt()` are provided by WHMCS
 *      and keyed by the installation's cc_encryption_hash),
 *   2. libsodium / OpenSSL AES-256-GCM keyed from the WHMCS encryption hash,
 *   3. refuse to store the secret at all.
 *
 * There is deliberately no "store it in plaintext" fallback: if no encryption
 * facility is available the save fails closed with CONFIGURATION_REQUIRED.
 */

namespace CloudHost247\Passkey;

final class Crypto
{
    const PREFIX = 'ch247pk:v1:';

    public static function encrypt($plaintext)
    {
        $plaintext = (string) $plaintext;
        if ($plaintext === '') {
            return '';
        }
        if (function_exists('encrypt')) {
            $value = (string) \encrypt($plaintext);
            if ($value !== '') {
                return 'whmcs:' . $value;
            }
        }
        $key = self::key();
        if ($key === '' || !function_exists('openssl_encrypt')) {
            throw new ConfigurationException('No encryption facility is available to store this secret safely.');
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            throw new ConfigurationException('Secret encryption failed.');
        }
        return self::PREFIX . base64_encode($iv . $tag . $cipher);
    }

    public static function decrypt($stored)
    {
        $stored = (string) $stored;
        if ($stored === '') {
            return '';
        }
        if (strncmp($stored, 'whmcs:', 6) === 0) {
            return function_exists('decrypt') ? (string) \decrypt(substr($stored, 6)) : '';
        }
        if (strncmp($stored, self::PREFIX, strlen(self::PREFIX)) !== 0) {
            return '';
        }
        $raw = base64_decode(substr($stored, strlen(self::PREFIX)), true);
        if ($raw === false || strlen($raw) < 29) {
            return '';
        }
        $key = self::key();
        if ($key === '' || !function_exists('openssl_decrypt')) {
            return '';
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $cipher = substr($raw, 28);
        $plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        return $plain === false ? '' : $plain;
    }

    /** Derives a 32-byte key from the WHMCS installation secret. */
    private static function key()
    {
        $material = '';
        if (isset($GLOBALS['cc_encryption_hash']) && is_string($GLOBALS['cc_encryption_hash'])) {
            $material = $GLOBALS['cc_encryption_hash'];
        } elseif (getenv('CH247_PASSKEY_SECRET_KEY')) {
            $material = (string) getenv('CH247_PASSKEY_SECRET_KEY');
        }
        if ($material === '') {
            return '';
        }
        return hash('sha256', 'cloudhost247-passkey-secret:' . $material, true);
    }
}
