<?php
namespace CloudHost247\Smm\Support;

/**
 * Pure credential redaction used before ANY provider request/response is
 * persisted or logged. Security-critical, therefore isolated and unit tested.
 */
final class Redactor
{
    const MAX_EXCERPT = 4000;

    /** Credential-shaped form field names (exact match, case-insensitive). */
    private static $credentialKeys = array('key', 'api_key', 'apikey', 'token', 'secret', 'password');

    /** Redact a request form array. */
    public static function redactRequest(array $request)
    {
        $out = array();
        foreach ($request as $k => $v) {
            if (in_array(strtolower((string) $k), self::$credentialKeys, true)) {
                $out[$k] = '[REDACTED]';
            } else {
                $out[$k] = is_scalar($v) || $v === null ? $v : '[complex]';
            }
        }
        return $out;
    }

    /**
     * Redact + bound a response (decoded array or raw string excerpt).
     * Defensive: even a provider echoing our key back gets scrubbed.
     */
    public static function redactResponse($response)
    {
        if ($response === null || $response === '') {
            return '';
        }
        if (is_string($response)) {
            $text = $response;
        } else {
            $text = json_encode($response, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (!is_string($text)) {
                return '[unencodable]';
            }
        }
        $text = preg_replace('/("(?:key|api_key|apikey|token|secret|password)"\s*:\s*)"[^"]*"/i', '$1"[REDACTED]"', $text);
        if (strlen($text) > self::MAX_EXCERPT) {
            $text = substr($text, 0, self::MAX_EXCERPT) . '…[truncated]';
        }
        return $text;
    }

    /** Encode a redacted request array to JSON. */
    public static function encode(array $data)
    {
        $text = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        return is_string($text) ? $text : '{}';
    }
}
