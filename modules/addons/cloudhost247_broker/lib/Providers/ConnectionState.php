<?php
namespace CloudHost247\Broker\Providers;

/**
 * The complete, closed set of provider connection states shown to a Super
 * Admin (requirement #19). A provider is never reported Connected simply
 * because configuration fields have been filled in — only a real, recent,
 * successful health check earns that label.
 */
final class ConnectionState
{
    const CONNECTED = 'connected';
    const AUTHENTICATION_FAILED = 'authentication_failed';
    const INVALID_CONFIGURATION = 'invalid_configuration';
    const PROVIDER_UNAVAILABLE = 'provider_unavailable';
    const TIMEOUT = 'timeout';
    const PERMISSION_DENIED = 'permission_denied';
    const NOT_CONFIGURED = 'not_configured';
    const MANUAL = 'manual';

    private static $labels = array(
        self::CONNECTED => 'Connected',
        self::AUTHENTICATION_FAILED => 'Authentication failed',
        self::INVALID_CONFIGURATION => 'Invalid configuration',
        self::PROVIDER_UNAVAILABLE => 'Provider unavailable',
        self::TIMEOUT => 'Timeout',
        self::PERMISSION_DENIED => 'Permission denied',
        self::NOT_CONFIGURED => 'Not configured',
        self::MANUAL => 'Manual broker (no external API)',
    );

    public static function label($state)
    {
        return isset(self::$labels[$state]) ? self::$labels[$state] : self::$labels[self::NOT_CONFIGURED];
    }

    /** Map a central CloudHost247\Integrations ResultCode onto our vocabulary. */
    public static function fromIntegrationResultCode($code)
    {
        $map = array(
            'connected' => self::CONNECTED,
            'authentication_failed' => self::AUTHENTICATION_FAILED,
            'invalid_endpoint' => self::INVALID_CONFIGURATION,
            'timeout' => self::TIMEOUT,
            'provider_unavailable' => self::PROVIDER_UNAVAILABLE,
            'invalid_configuration' => self::INVALID_CONFIGURATION,
            'permission_denied' => self::PERMISSION_DENIED,
            'disabled' => self::NOT_CONFIGURED,
            'not_configured' => self::NOT_CONFIGURED,
            'unknown' => self::NOT_CONFIGURED,
        );
        return isset($map[$code]) ? $map[$code] : self::NOT_CONFIGURED;
    }
}
