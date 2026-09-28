<?php
namespace CloudHost247\Integrations\Support;

/**
 * The complete, closed set of connection results an administrator may see.
 *
 * Raw provider payloads, credentials, headers and stack traces are never part
 * of a result; only one of these codes plus a fixed human label is returned.
 */
final class ResultCode
{
    const CONNECTED = 'connected';
    const AUTHENTICATION_FAILED = 'authentication_failed';
    const INVALID_ENDPOINT = 'invalid_endpoint';
    const TIMEOUT = 'timeout';
    const PROVIDER_UNAVAILABLE = 'provider_unavailable';
    const INVALID_CONFIGURATION = 'invalid_configuration';
    const PERMISSION_DENIED = 'permission_denied';
    const DISABLED = 'disabled';
    const NOT_CONFIGURED = 'not_configured';
    const UNKNOWN = 'unknown';

    private static $labels = array(
        self::CONNECTED => 'Connected successfully',
        self::AUTHENTICATION_FAILED => 'Authentication failed',
        self::INVALID_ENDPOINT => 'Invalid endpoint',
        self::TIMEOUT => 'Timeout',
        self::PROVIDER_UNAVAILABLE => 'Provider unavailable',
        self::INVALID_CONFIGURATION => 'Invalid configuration',
        self::PERMISSION_DENIED => 'Permission denied',
        self::DISABLED => 'Disabled',
        self::NOT_CONFIGURED => 'Not configured',
        self::UNKNOWN => 'NOT VERIFIED',
    );

    public static function all()
    {
        return array_keys(self::$labels);
    }

    public static function isValid($code)
    {
        return is_string($code) && isset(self::$labels[$code]);
    }

    public static function label($code)
    {
        return self::isValid($code) ? self::$labels[$code] : self::$labels[self::UNKNOWN];
    }

    public static function isSuccess($code)
    {
        return $code === self::CONNECTED;
    }

    /** Map an HTTP status code from a provider onto a safe result code. */
    public static function fromHttpStatus($status)
    {
        $status = (int) $status;
        if ($status >= 200 && $status < 300) { return self::CONNECTED; }
        if ($status === 401 || $status === 407) { return self::AUTHENTICATION_FAILED; }
        if ($status === 403) { return self::PERMISSION_DENIED; }
        if ($status === 404 || $status === 405 || $status === 410) { return self::INVALID_ENDPOINT; }
        if ($status === 408) { return self::TIMEOUT; }
        if ($status === 400 || $status === 422) { return self::INVALID_CONFIGURATION; }
        if ($status === 429 || $status >= 500) { return self::PROVIDER_UNAVAILABLE; }
        if ($status >= 300 && $status < 400) { return self::INVALID_ENDPOINT; }
        return self::PROVIDER_UNAVAILABLE;
    }

    /** Map a transport failure kind onto a safe result code. */
    public static function fromTransportKind($kind)
    {
        switch ((string) $kind) {
            case 'timeout':
                return self::TIMEOUT;
            case 'tls':
            case 'dns':
                return self::INVALID_ENDPOINT;
            case 'too_large':
                return self::PROVIDER_UNAVAILABLE;
            case 'configuration':
                return self::INVALID_CONFIGURATION;
            default:
                return self::PROVIDER_UNAVAILABLE;
        }
    }
}
