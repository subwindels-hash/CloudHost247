<?php
/**
 * Number Provider Interface
 */

namespace PhoneServices\Interfaces;

interface NumberProviderInterface extends TelecomProviderInterface
{
    /**
     * Search available numbers by country and type
     */
    public function searchNumbers(string $country, string $type = 'local', array $filters = []): array;
    
    /**
     * Purchase a number
     */
    public function purchaseNumber(string $number, string $country, array $options = []): array;
    
    /**
     * Release a number back to pool
     */
    public function releaseNumber(string $numberId): bool;
    
    /**
     * Renew a number subscription
     */
    public function renewNumber(string $numberId, int $months = 1): array;
    
    /**
     * Get number details
     */
    public function getNumberDetails(string $numberId): array;
    
    /**
     * Update number configuration (webhook, voice url, etc.)
     */
    public function updateNumberConfig(string $numberId, array $config): bool;
}
