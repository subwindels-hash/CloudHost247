<?php
/**
 * Provider factory.
 *
 * The provider is chosen per product (configoption1); there is no global
 * "default provider" that could silently provision on the wrong platform.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Providers;

use HostxEmail\Support\Config;
use HostxEmail\Support\HttpClient;

final class ProviderFactory
{
    /**
     * key => [label, class]
     *
     * @var array<string,array<string,string>>
     */
    const PROVIDERS = [
        Config::PROVIDER_PROFESSIONAL => [
            'label' => 'Professional Business Email',
            'class' => ProfessionalEmailProvider::class,
        ],
        Config::PROVIDER_MICROSOFT => [
            'label' => 'Microsoft 365',
            'class' => Microsoft365Provider::class,
        ],
        Config::PROVIDER_GOOGLE => [
            'label' => 'Google Workspace',
            'class' => GoogleWorkspaceProvider::class,
        ],
    ];

    /**
     * Build the adapter for a service's configured provider.
     */
    public static function make(Config $config, ?HttpClient $http = null): ProviderInterface
    {
        return self::makeFor($config->provider(), $config, $http);
    }

    public static function makeFor(string $key, Config $config, ?HttpClient $http = null): ProviderInterface
    {
        $class = self::PROVIDERS[$key]['class'] ?? ProfessionalEmailProvider::class;

        /** @var ProviderInterface $provider */
        $provider = new $class($config, $http);

        return $provider;
    }

    /**
     * Options for the WHMCS product configuration dropdown.
     *
     * @return array<string,string>
     */
    public static function options(): array
    {
        $options = [];

        foreach (self::PROVIDERS as $key => $meta) {
            $options[$key] = $meta['label'];
        }

        return $options;
    }

    public static function label(string $key): string
    {
        return self::PROVIDERS[$key]['label'] ?? ucfirst($key);
    }

    public static function exists(string $key): bool
    {
        return isset(self::PROVIDERS[$key]);
    }
}
