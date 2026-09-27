<?php
/**
 * Provider Factory
 * Creates provider instances based on configuration
 */

namespace PhoneServices\Providers;

use PhoneServices\Core\Config;
use PhoneServices\Core\Logger;

class ProviderFactory
{
    private static $providers = [];
    
    /**
     * Get available provider names
     */
    public static function getAvailableProviders(): array
    {
        return [
            'twilio' => 'Twilio',
            'vonage' => 'Vonage',
            'airalo' => 'Airalo',
            'truphone' => 'Truphone',
        ];
    }
    
    /**
     * Get provider instance by name
     */
    public static function getProvider(string $name)
    {
        if (isset(self::$providers[$name])) {
            return self::$providers[$name];
        }
        
        $instance = null;
        
        switch (strtolower($name)) {
            case 'twilio':
                $instance = new TwilioProvider();
                break;
            case 'vonage':
                $instance = new VonageProvider();
                break;
            case 'airalo':
                $instance = new AiraloProvider();
                break;
            case 'truphone':
                $instance = new TruphoneProvider();
                break;
            default:
                Logger::error("Unknown provider requested: {$name}");
                return null;
        }
        
        if ($instance) {
            $credentials = Config::getProviderCredentials($name);
            $instance->configure($credentials);
        }
        
        self::$providers[$name] = $instance;
        return $instance;
    }
    
    /**
     * Get default provider
     */
    public static function getDefaultProvider(string $serviceType = null)
    {
        $default = Config::get('default_provider', 'twilio');
        
        // Service-specific provider overrides can be added here
        if ($serviceType) {
            $serviceProvider = Config::get("provider_{$serviceType}", '');
            if ($serviceProvider) {
                $default = $serviceProvider;
            }
        }
        
        return self::getProvider($default);
    }
    
    /**
     * Get provider for a specific service type with fallback
     */
    public static function getProviderForService(string $serviceType, string $preferred = null)
    {
        if ($preferred) {
            $provider = self::getProvider($preferred);
            if ($provider && $provider->isAvailable()) {
                return $provider;
            }
        }
        
        // Try service-specific provider
        $serviceProvider = Config::get("provider_{$serviceType}", '');
        if ($serviceProvider) {
            $provider = self::getProvider($serviceProvider);
            if ($provider && $provider->isAvailable()) {
                return $provider;
            }
        }
        
        // Fallback to default
        return self::getDefaultProvider();
    }
    
    /**
     * Clear cached providers
     */
    public static function clearCache(): void
    {
        self::$providers = [];
    }
}
