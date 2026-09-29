<?php
namespace CloudHost247\Broker\Providers;

use CloudHost247\Broker\Repositories\ProviderConfigRepository;
use InvalidArgumentException;

/**
 * Central lookup of every acquisition-provider adapter the platform knows
 * about. Adding a future provider means writing one adapter class and
 * registering it here (or calling register() from another module's
 * bootstrap) — the routing engine, the admin Providers screen and the
 * customer-facing case detail never need to change (requirement #9).
 */
final class AdapterRegistry
{
    private static $builtIn = null;
    private static $extra = array();

    private static function builtIn()
    {
        if (self::$builtIn === null) {
            self::$builtIn = array(
                ManualBrokerAdapter::KEY => __NAMESPACE__ . '\\ManualBrokerAdapter',
                GoDaddyAdapter::KEY => __NAMESPACE__ . '\\GoDaddyAdapter',
                SedoAdapter::KEY => __NAMESPACE__ . '\\SedoAdapter',
                AfternicAdapter::KEY => __NAMESPACE__ . '\\AfternicAdapter',
                DomainAgentsAdapter::KEY => __NAMESPACE__ . '\\DomainAgentsAdapter',
            );
        }
        return self::$builtIn;
    }

    /** Register an additional provider adapter class at runtime. */
    public static function register($key, $adapterClass)
    {
        if (!preg_match('/^[a-z][a-z0-9_]{1,31}$/', (string) $key)) {
            throw new InvalidArgumentException('Invalid provider key.');
        }
        if (!is_a($adapterClass, ProviderAdapter::class, true)) {
            throw new InvalidArgumentException('Adapter must implement ProviderAdapter.');
        }
        self::$extra[$key] = $adapterClass;
    }

    public static function keys()
    {
        return array_keys(array_merge(self::builtIn(), self::$extra));
    }

    public function get($key, ProviderConfigRepository $configRepository = null)
    {
        $map = array_merge(self::builtIn(), self::$extra);
        if (!isset($map[$key])) {
            throw new InvalidArgumentException('Unknown domain acquisition provider.');
        }
        $class = $map[$key];
        if ($key === ManualBrokerAdapter::KEY) { return new $class(); }
        return new $class($configRepository);
    }

    /** @return ProviderAdapter[] keyed by provider key, in a stable order (manual last as the fallback). */
    public function all(ProviderConfigRepository $configRepository = null)
    {
        $configRepository = $configRepository ?: new ProviderConfigRepository();
        $out = array();
        foreach (array_merge(self::builtIn(), self::$extra) as $key => $class) {
            $out[$key] = $this->get($key, $configRepository);
        }
        return $out;
    }
}
