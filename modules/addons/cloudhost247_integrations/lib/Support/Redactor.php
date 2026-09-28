<?php
namespace CloudHost247\Integrations\Support;

/**
 * Last-resort sanitizer applied to everything that may reach a log line, an
 * audit record, an administrator screen or an API response.
 *
 * The integration layer is designed so that secrets never reach these paths in
 * the first place; the redactor exists so that a future mistake still cannot
 * publish a credential.
 */
final class Redactor
{
    const PLACEHOLDER = '[REDACTED]';

    /** Header names whose value is never recorded anywhere. */
    private static $sensitiveHeaders = array(
        'authorization', 'proxy-authorization', 'x-api-key', 'x-auth-token', 'x-ovh-signature',
        'x-ovh-application', 'x-ovh-consumer', 'cookie', 'set-cookie', 'anthropic-api-key',
        'x-amz-security-token', 'x-amz-content-sha256', 'x-goog-api-key',
    );

    /**
     * Remove credential material from a URL: user-info, query strings and any
     * provider path segment that embeds a token (for example Telegram's
     * /bot<token>/ path, which the provider protocol mandates).
     */
    public static function url($url)
    {
        $url = (string) $url;
        if ($url === '') { return ''; }
        $parts = @parse_url($url);
        if (!is_array($parts) || empty($parts['host'])) { return self::PLACEHOLDER; }
        $scheme = isset($parts['scheme']) ? $parts['scheme'] : 'https';
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        $path = isset($parts['path']) ? $parts['path'] : '';
        $safePath = '';
        foreach (explode('/', $path) as $segment) {
            if ($segment === '') { continue; }
            $safePath .= '/' . self::pathSegment($segment);
        }
        $suffix = isset($parts['query']) && $parts['query'] !== '' ? '?' . self::PLACEHOLDER : '';
        return $scheme . '://' . strtolower($parts['host']) . $port . $safePath . $suffix;
    }

    /** Reduce headers to names only, with sensitive values replaced. */
    public static function headers(array $headers)
    {
        $safe = array();
        foreach ($headers as $key => $value) {
            $line = is_int($key) ? (string) $value : $key . ': ' . $value;
            $name = strtolower(trim(substr($line, 0, strpos($line, ':') === false ? strlen($line) : strpos($line, ':'))));
            $safe[] = in_array($name, self::$sensitiveHeaders, true) ? $name . ': ' . self::PLACEHOLDER : $name;
        }
        return $safe;
    }

    /**
     * Produce a short, sanitized administrator-facing detail string.
     * Long tokens, base64 blobs and key-like values are replaced.
     */
    public static function text($value, $limit = 255)
    {
        $value = strip_tags((string) $value);
        $value = preg_replace('/[\r\n\t]+/', ' ', $value);
        $value = preg_replace('/\b(?:[A-Za-z0-9_\-]{28,}|[A-Fa-f0-9]{32,})\b/', self::PLACEHOLDER, $value);
        $value = preg_replace('/\b(sk|pk|rk|api|key|token|secret|pass)[_\-][A-Za-z0-9]{6,}/i', self::PLACEHOLDER, $value);
        $value = trim(preg_replace('/\s{2,}/', ' ', $value));
        $limit = max(16, min(1000, (int) $limit));
        return function_exists('mb_substr') ? mb_substr($value, 0, $limit) : substr($value, 0, $limit);
    }

    /**
     * Mask a stored secret for display. The plaintext is never used; only the
     * non-reversible fingerprint recorded at save time is shown so that two
     * administrators can confirm they are looking at the same credential.
     */
    public static function maskedSecret($fingerprint, $rotatedAt = null)
    {
        $fingerprint = preg_match('/^[a-f0-9]{8,32}$/', (string) $fingerprint) ? (string) $fingerprint : '';
        if ($fingerprint === '') { return 'Not set'; }
        $label = str_repeat("\xe2\x80\xa2", 12) . ' stored (fingerprint ' . substr($fingerprint, 0, 8) . ')';
        if ($rotatedAt) { $label .= ', updated ' . self::text($rotatedAt, 32); }
        return $label;
    }

    private static function pathSegment($segment)
    {
        if (strlen($segment) >= 20 && preg_match('/[A-Za-z0-9_\-]{20,}/', $segment)) { return self::PLACEHOLDER; }
        if (preg_match('/^bot[0-9]+:/i', $segment)) { return self::PLACEHOLDER; }
        return preg_replace('/[^A-Za-z0-9._~\-]/', '', $segment);
    }
}
