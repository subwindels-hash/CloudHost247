<?php
/**
 * Secret redaction for logs and audit records.
 *
 * Nothing leaves this module towards a log sink without passing through here.
 * Redaction is by key name (recursive) and by value pattern (bearer tokens,
 * PEM private keys, JWT-looking strings), because provider payloads nest
 * credentials in places a key-only filter would miss.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Support;

final class Redactor
{
    const MASK = '[REDACTED]';

    /**
     * Key fragments that mark a value as sensitive.
     *
     * @var array<int,string>
     */
    private static $keys = [
        'password', 'passwd', 'pwd', 'secret', 'client_secret', 'clientsecret',
        'token', 'access_token', 'refresh_token', 'id_token', 'apikey', 'api_key',
        'authorization', 'auth', 'private_key', 'privatekey', 'serviceaccount',
        'service_account', 'accesshash', 'access_hash', 'signature', 'credential',
        'assertion', 'cookie', 'set-cookie', 'x-api-key', 'passwordprofile',
    ];

    /**
     * Keys that are safe even though they match a fragment above.
     *
     * @var array<int,string>
     */
    private static $allow = ['password_policy', 'password_changed_at', 'token_expires_at'];

    /**
     * Recursively redact an array.
     *
     * @param  array<string|int,mixed> $data
     * @return array<string|int,mixed>
     */
    public static function redact(array $data, int $depth = 0): array
    {
        if ($depth > 12) {
            return ['_truncated' => true];
        }

        $out = [];

        foreach ($data as $key => $value) {
            if (self::isSensitiveKey((string) $key)) {
                $out[$key] = self::MASK;
                continue;
            }

            if (is_array($value)) {
                $out[$key] = self::redact($value, $depth + 1);
                continue;
            }

            if (is_object($value)) {
                $out[$key] = self::redact(json_decode((string) json_encode($value), true) ?: [], $depth + 1);
                continue;
            }

            $out[$key] = is_string($value) ? self::scrub($value) : $value;
        }

        return $out;
    }

    public static function isSensitiveKey(string $key): bool
    {
        $normal = strtolower(str_replace(['-', ' '], '_', $key));

        if (in_array($normal, self::$allow, true)) {
            return false;
        }

        foreach (self::$keys as $needle) {
            if (strpos($normal, str_replace('-', '_', $needle)) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * Scrub secret-looking substrings out of a free-text value.
     */
    public static function scrub(string $value): string
    {
        if ($value === '') {
            return $value;
        }

        $patterns = [
            // Authorization headers.
            '/(Bearer|Basic)\s+[A-Za-z0-9\-\._~\+\/=]{8,}/i' => '$1 ' . self::MASK,
            // PEM blocks.
            '/-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----/s' => self::MASK,
            // JWTs (three base64url segments).
            '/\beyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\b/' => self::MASK,
            // Explicit key=value pairs in query strings or bodies.
            '/((?:client_secret|api_key|apikey|access_token|refresh_token|password)=)[^&\s"\']+/i' => '$1' . self::MASK,
        ];

        foreach ($patterns as $pattern => $replacement) {
            $result = preg_replace($pattern, $replacement, $value);

            if ($result !== null) {
                $value = $result;
            }
        }

        return $value;
    }

    /**
     * Redact HTTP headers before logging.
     *
     * @param  array<string,string> $headers
     * @return array<string,string>
     */
    public static function headers(array $headers): array
    {
        $out = [];

        foreach ($headers as $name => $value) {
            $out[$name] = self::isSensitiveKey((string) $name) ? self::MASK : self::scrub((string) $value);
        }

        return $out;
    }

    /**
     * Redact a JSON string, falling back to pattern scrubbing when the payload
     * is not valid JSON.
     */
    public static function json(string $payload, int $limit = 4000): string
    {
        $decoded = json_decode($payload, true);

        if (is_array($decoded)) {
            $encoded = json_encode(self::redact($decoded));

            return substr($encoded === false ? '' : $encoded, 0, $limit);
        }

        return substr(self::scrub($payload), 0, $limit);
    }
}
