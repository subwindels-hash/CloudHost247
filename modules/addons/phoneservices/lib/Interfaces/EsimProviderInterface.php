<?php
/**
 * eSIM Provider Interface
 */

namespace PhoneServices\Interfaces;

interface EsimProviderInterface extends TelecomProviderInterface
{
    /**
     * Get available eSIM plans
     */
    public function getPlans(string $country = null, string $region = null): array;
    
    /**
     * Purchase an eSIM plan
     */
    public function purchasePlan(string $planId, array $options = []): array;
    
    /**
     * Get eSIM details and QR code data
     */
    public function getEsimDetails(string $esimId): array;
    
    /**
     * Get QR code provisioning data
     */
    public function getQrCodeData(string $esimId): string;
    
    /**
     * Check data usage
     */
    public function checkUsage(string $esimId): array;
    
    /**
     * Top up an eSIM
     */
    public function topUp(string $esimId, string $planId): array;
}
