<?php
/**
 * Base Telecom Provider Interface
 * All providers must implement this contract
 */

namespace PhoneServices\Interfaces;

interface TelecomProviderInterface
{
    /**
     * Get provider name
     */
    public function getName(): string;
    
    /**
     * Check if provider is properly configured and available
     */
    public function isAvailable(): bool;
    
    /**
     * Get provider capabilities
     */
    public function getCapabilities(): array;
    
    /**
     * Set credentials/config
     */
    public function configure(array $config): void;
    
    /**
     * Test connection to provider
     */
    public function testConnection(): bool;
}
