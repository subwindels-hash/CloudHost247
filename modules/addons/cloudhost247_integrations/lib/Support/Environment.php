<?php
namespace CloudHost247\Integrations\Support;

use InvalidArgumentException;

/**
 * Deployment environment resolution.
 *
 * Every stored integration belongs to exactly one environment so that test and
 * production credentials can never be mixed. The environment that the running
 * application uses is resolved server-side only, from deployment configuration
 * (never from a request parameter).
 */
final class Environment
{
    const DEVELOPMENT = 'development';
    const STAGING = 'staging';
    const PRODUCTION = 'production';

    /** Deployment configuration sources, in priority order. */
    const ENV_VARIABLE = 'CH247_PLATFORM_ENVIRONMENT';
    const GLOBAL_VARIABLE = 'ch247_platform_environment';

    public static function supported()
    {
        return array(self::DEVELOPMENT, self::STAGING, self::PRODUCTION);
    }

    public static function assert($environment)
    {
        $environment = strtolower(trim((string) $environment));
        if (!in_array($environment, self::supported(), true)) {
            throw new InvalidArgumentException('Unsupported deployment environment.');
        }
        return $environment;
    }

    /**
     * The environment the application resolves configuration for at runtime.
     *
     * Defaults to production so that an unconfigured deployment never silently
     * loads development or staging credentials.
     */
    public static function active()
    {
        $configured = self::configured();
        return $configured === null ? self::PRODUCTION : $configured;
    }

    /** True when the deployment explicitly declared its environment. */
    public static function isExplicit()
    {
        return self::configured() !== null;
    }

    public static function source()
    {
        if (self::fromEnvVariable() !== null) { return self::ENV_VARIABLE; }
        if (self::fromGlobal() !== null) { return 'configuration.php $' . self::GLOBAL_VARIABLE; }
        return 'default';
    }

    /** True when the named environment holds production credentials. */
    public static function isProduction($environment)
    {
        return self::assert($environment) === self::PRODUCTION;
    }

    private static function configured()
    {
        $value = self::fromEnvVariable();
        if ($value === null) { $value = self::fromGlobal(); }
        if ($value === null) { return null; }
        $value = strtolower(trim($value));
        return in_array($value, self::supported(), true) ? $value : null;
    }

    private static function fromEnvVariable()
    {
        $value = getenv(self::ENV_VARIABLE);
        return is_string($value) && $value !== '' ? $value : null;
    }

    private static function fromGlobal()
    {
        if (!isset($GLOBALS[self::GLOBAL_VARIABLE])) { return null; }
        $value = $GLOBALS[self::GLOBAL_VARIABLE];
        return is_string($value) && $value !== '' ? $value : null;
    }
}
