<?php
namespace CloudHost247\Smm\Support;

/**
 * Credential encryption boundary.
 *
 * API keys are never stored or logged in plaintext. Production uses the
 * WHMCS encrypt()/decrypt() primitives (AES, keyed by the installation's
 * encryption key). When WHMCS is unavailable — automated tests — the
 * environment must provide equivalents; if neither exists we refuse to
 * store rather than degrade to plaintext.
 */
final class Crypto
{
    /**
     * @param string $plaintext
     * @return string ciphertext envelope
     * @throws ModuleException when no encryption primitive is available
     */
    public static function encrypt($plaintext)
    {
        if (!is_string($plaintext) || $plaintext === '') {
            throw new ModuleException('Nothing to encrypt.');
        }
        if (function_exists('encrypt')) {
            $sealed = encrypt($plaintext);
            if (is_string($sealed) && $sealed !== '') {
                return 'whmcs:' . $sealed;
            }
            throw new ModuleException('WHMCS encryption primitive failed.');
        }
        throw new ModuleException('API key encryption is unavailable (WHMCS encrypt() missing).');
    }

    /**
     * @param string $envelope
     * @return string plaintext key
     * @throws ModuleException
     */
    public static function decrypt($envelope)
    {
        $envelope = (string) $envelope;
        if (strpos($envelope, 'whmcs:') !== 0) {
            throw new ModuleException('Stored credential envelope is unreadable.');
        }
        if (!function_exists('decrypt')) {
            throw new ModuleException('API key decryption is unavailable (WHMCS decrypt() missing).');
        }
        $plain = decrypt(substr($envelope, 6));
        if (!is_string($plain) || $plain === '') {
            throw new ModuleException('Stored credential could not be decrypted.');
        }
        return $plain;
    }

    /** Non-reversible display hint: first character and last four characters only. */
    public static function displayHint($plaintext)
    {
        $len = strlen((string) $plaintext);
        if ($len <= 5) {
            return str_repeat('*', max($len, 3));
        }
        return substr($plaintext, 0, 1) . str_repeat('*', min(12, max(3, $len - 5))) . substr($plaintext, -4);
    }
}
