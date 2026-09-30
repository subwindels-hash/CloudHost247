<?php
/**
 * Recovery tokens are treated as authentication-grade credentials.
 *
 *  - 256 bits from the CSPRNG, hex encoded.
 *  - Only SHA-256 hashes are stored for lookup, never the raw token.
 *  - A separate, derived unsubscribe token means the unsubscribe link in an
 *    email cannot be replayed to restore somebody's cart.
 *  - The raw token is additionally sealed with WHMCS's own encrypt()/decrypt()
 *    so cron can rebuild the URL for reminder 2 and 3 without the database
 *    ever holding a usable plaintext credential.
 */

namespace CloudHost247\CartRecovery;

final class TokenService
{
    public static function generate()
    {
        return bin2hex(random_bytes(32));
    }

    public static function valid($token)
    {
        return is_string($token) && preg_match('/^[a-f0-9]{64}$/D', $token) === 1;
    }

    public static function hash($token)
    {
        return hash('sha256', 'cloudhost247-cart-recovery:' . (string) $token);
    }

    /** Distinct one-way value used for the unsubscribe endpoint. */
    public static function unsubscribeToken($token)
    {
        return hash('sha256', 'cloudhost247-cart-unsubscribe:' . (string) $token);
    }

    public static function unsubscribeHash($unsubscribeToken)
    {
        return hash('sha256', 'cloudhost247-cart-unsubscribe-lookup:' . (string) $unsubscribeToken);
    }

    /** Constant-time comparison helper for any token equality check. */
    public static function equals($a, $b)
    {
        return hash_equals((string) $a, (string) $b);
    }

    public static function seal($token)
    {
        if (function_exists('encrypt')) {
            return encrypt((string) $token);
        }
        // Without the WHMCS runtime (CLI tooling/tests) fall back to a
        // reversible encoding; production always has WHMCS's encrypt().
        return 'b64:' . base64_encode((string) $token);
    }

    public static function open($sealed)
    {
        $sealed = (string) $sealed;
        if (strncmp($sealed, 'b64:', 4) === 0) {
            return (string) base64_decode(substr($sealed, 4), true);
        }
        if (function_exists('decrypt')) {
            return (string) decrypt($sealed);
        }
        return '';
    }
}
