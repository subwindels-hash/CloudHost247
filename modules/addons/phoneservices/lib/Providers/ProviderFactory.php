<?php
/**
 * Provider Factory
 *
 * Resolves configured provider implementations. Services never instantiate a
 * concrete provider: they ask for a capability and the factory returns the
 * implementation the administrator selected, so providers can be switched from
 * the admin panel without a code change.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

use PhoneServices\Core\Config;
use PhoneServices\Core\Logger;
use PhoneServices\Interfaces\TelecomProviderInterface;

class ProviderFactory
{
    /** @var array<string,TelecomProviderInterface|null> */
    private static $instances = [];

    /**
     * id => label of every known provider.
     *
     * @return array<string,string>
     */
    public static function getAvailableProviders(): array
    {
        return ProviderRegistry::labels();
    }

    /**
     * Instantiate (and configure) a provider by id.
     */
    public static function getProvider(string $name): ?TelecomProviderInterface
    {
        $name = strtolower(trim($name));

        if (array_key_exists($name, self::$instances)) {
            return self::$instances[$name];
        }

        $class = ProviderRegistry::className($name);

        if ($class === null) {
            Logger::error('Unknown provider requested', ['provider' => $name]);
            return self::$instances[$name] = null;
        }

        if (!class_exists($class)) {
            Logger::error('Provider class not found', ['provider' => $name, 'class' => $class]);
            return self::$instances[$name] = null;
        }

        try {
            /** @var TelecomProviderInterface $instance */
            $instance = new $class();

            if (!$instance instanceof TelecomProviderInterface) {
                Logger::error('Provider does not implement TelecomProviderInterface', ['provider' => $name]);
                return self::$instances[$name] = null;
            }

            $instance->configure(Config::getProviderCredentials($name));
        } catch (\Throwable $e) {
            Logger::error('Provider initialisation failed: ' . $e->getMessage(), ['provider' => $name]);
            return self::$instances[$name] = null;
        }

        return self::$instances[$name] = $instance;
    }

    /**
     * Resolve the provider responsible for a capability.
     *
     * Resolution order:
     *   1. explicit $preferred (e.g. a per-number provider stored on the row)
     *   2. provider_{capability} setting
     *   3. default_provider setting
     *   4. first registered, configured provider advertising the capability
     */
    public static function forCapability(string $capability, ?string $preferred = null): ?TelecomProviderInterface
    {
        $candidates = [];

        if ($preferred) {
            $candidates[] = strtolower($preferred);
        }

        $candidates[] = Config::getProviderForCapability($capability);
        $candidates[] = (string) Config::get('default_provider', 'twilio');
        $candidates = array_values(array_unique(array_filter($candidates)));

        foreach ($candidates as $candidate) {
            $provider = self::getProvider($candidate);
            if ($provider && $provider->supports($capability) && $provider->isAvailable()) {
                return $provider;
            }
        }

        // Last resort: any registered provider that can do the job.
        foreach (array_keys(ProviderRegistry::forCapability($capability)) as $id) {
            $provider = self::getProvider($id);
            if ($provider && $provider->isAvailable()) {
                Logger::warning('Falling back to alternate provider', [
                    'capability' => $capability,
                    'provider'   => $id,
                ]);
                return $provider;
            }
        }

        Logger::error('No configured provider available for capability', ['capability' => $capability]);

        return null;
    }

    /**
     * Back-compat alias used by earlier releases / integrations.
     */
    public static function getProviderForService(string $serviceType, ?string $preferred = null): ?TelecomProviderInterface
    {
        return self::forCapability($serviceType, $preferred);
    }

    public static function getDefaultProvider(?string $serviceType = null): ?TelecomProviderInterface
    {
        if ($serviceType) {
            return self::forCapability($serviceType);
        }

        return self::getProvider((string) Config::get('default_provider', 'twilio'));
    }

    /**
     * Health snapshot for the admin dashboard.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function healthCheck(): array
    {
        $report = [];

        foreach (ProviderRegistry::all() as $id => $definition) {
            $provider = self::getProvider($id);
            $configured = $provider !== null && $provider->isAvailable();

            $report[] = [
                'id'           => $id,
                'label'        => $definition['label'],
                'capabilities' => $definition['capabilities'],
                'configured'   => $configured,
                'reachable'    => $configured ? $provider->testConnection() : false,
                'error'        => $provider ? $provider->getLastError() : 'Provider class unavailable',
            ];
        }

        return $report;
    }

    public static function clearCache(): void
    {
        self::$instances = [];
    }

    /**
     * Test seam: inject a provider instance.
     */
    public static function setInstance(string $name, ?TelecomProviderInterface $provider): void
    {
        self::$instances[strtolower($name)] = $provider;
    }
}
