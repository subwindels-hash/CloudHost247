<?php
/**
 * RFC 4648 §5 base64url helpers. WebAuthn transports every binary value this
 * way, so encoding lives in one place rather than being re-implemented in
 * each service.
 */

namespace CloudHost247\Passkey;

final class Base64Url
{
    public static function encode($binary)
    {
        return rtrim(strtr(base64_encode((string) $binary), '+/', '-_'), '=');
    }

    /**
     * Strict decode: anything that is not valid base64url returns null so the
     * caller can reject the ceremony instead of silently operating on
     * corrupted bytes.
     *
     * @return string|null
     */
    public static function decode($value)
    {
        $value = (string) $value;
        if ($value === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
            return null;
        }
        $padded = strtr($value, '-_', '+/');
        $remainder = strlen($padded) % 4;
        if ($remainder === 1) {
            return null;
        }
        if ($remainder > 0) {
            $padded .= str_repeat('=', 4 - $remainder);
        }
        $decoded = base64_decode($padded, true);
        return $decoded === false ? null : $decoded;
    }
}
