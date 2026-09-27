<?php
/**
 * Number Service
 * Handles virtual phone number lifecycle management
 */

namespace PhoneServices\Services;

use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Config;
use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Interfaces\NumberProviderInterface;

class NumberService
{
    private $provider;
    
    public function __construct(string $providerName = null)
    {
        $this->provider = ProviderFactory::getProviderForService('numbers', $providerName);
    }
    
    /**
     * Search available numbers
     */
    public function searchNumbers(string $country, string $type = 'local', array $filters = []): array
    {
        if (!$this->provider || !($this->provider instanceof NumberProviderInterface)) {
            return ['error' => 'Number provider not available'];
        }
        
        return $this->provider->searchNumbers($country, $type, $filters);
    }
    
    /**
     * Purchase and assign a number to user
     */
    public function purchaseNumber(int $userId, string $number, string $country, string $type = 'local', array $options = []): array
    {
        if (!$this->provider || !($this->provider instanceof NumberProviderInterface)) {
            return ['error' => 'Number provider not available'];
        }
        
        $webhookBase = Config::get('webhook_base_url', '');
        if ($webhookBase) {
            $options['voice_url'] = $webhookBase . '/modules/addons/phoneservices/api/webhooks/twilio.php?type=voice';
            $options['sms_url'] = $webhookBase . '/modules/addons/phoneservices/api/webhooks/twilio.php?type=sms';
        }
        
        $result = $this->provider->purchaseNumber($number, $country, $options);
        
        if (isset($result['error'])) {
            Logger::error('Number purchase failed', ['user' => $userId, 'error' => $result['error']]);
            return $result;
        }
        
        // Record in database
        $record = [
            'user_id' => $userId,
            'provider' => $this->provider->getName(),
            'provider_id' => $result['provider_id'],
            'number' => $result['number'],
            'country' => strtoupper($country),
            'type' => $type,
            'status' => 'active',
            'friendly_name' => $options['friendly_name'] ?? $result['number'],
            'monthly_cost' => $options['monthly_cost'] ?? 0.00,
            'purchased_at' => date('Y-m-d H:i:s'),
            'next_renewal' => date('Y-m-d H:i:s', strtotime('+1 month')),
        ];
        
        $id = Database::insert('mod_phoneservices_numbers', $record);
        
        Logger::info('Number purchased', ['id' => $id, 'user' => $userId, 'number' => $number]);
        
        return array_merge($result, ['id' => $id]);
    }
    
    /**
     * Activate a number
     */
    public function activateNumber(int $numberId): bool
    {
        $number = Database::row('mod_phoneservices_numbers', '*', ['id' => $numberId]);
        if (!$number) {
            return false;
        }
        
        Database::update('mod_phoneservices_numbers', [
            'status' => 'active',
            'activated_at' => date('Y-m-d H:i:s'),
        ], ['id' => $numberId]);
        
        Logger::info('Number activated', ['id' => $numberId]);
        return true;
    }
    
    /**
     * Assign number to a service/product
     */
    public function assignNumber(int $numberId, int $serviceId): bool
    {
        Database::update('mod_phoneservices_numbers', [
            'assigned_service_id' => $serviceId,
            'assigned_at' => date('Y-m-d H:i:s'),
        ], ['id' => $numberId]);
        
        Logger::info('Number assigned to service', ['number_id' => $numberId, 'service_id' => $serviceId]);
        return true;
    }
    
    /**
     * Renew number subscription
     */
    public function renewNumber(int $numberId, int $months = 1): array
    {
        $number = Database::row('mod_phoneservices_numbers', '*', ['id' => $numberId]);
        if (!$number) {
            return ['error' => 'Number not found'];
        }
        
        $provider = ProviderFactory::getProvider($number['provider']);
        if ($provider && $provider instanceof NumberProviderInterface) {
            $result = $provider->renewNumber($number['provider_id'], $months);
            if (isset($result['error'])) {
                return $result;
            }
        }
        
        $nextRenewal = date('Y-m-d H:i:s', strtotime("+{$months} month", strtotime($number['next_renewal'])));
        
        Database::update('mod_phoneservices_numbers', [
            'status' => 'active',
            'next_renewal' => $nextRenewal,
            'renewed_at' => date('Y-m-d H:i:s'),
            'renewal_count' => ($number['renewal_count'] ?? 0) + 1,
        ], ['id' => $numberId]);
        
        // Log transaction
        $cost = ($number['monthly_cost'] ?? 0) * $months;
        Database::insert('mod_phoneservices_transactions', [
            'user_id' => $number['user_id'],
            'service_type' => 'number_renewal',
            'reference_id' => $numberId,
            'amount' => $cost,
            'currency' => 'USD',
            'status' => 'completed',
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        
        Logger::info('Number renewed', ['id' => $numberId, 'months' => $months]);
        return ['success' => true, 'next_renewal' => $nextRenewal];
    }
    
    /**
     * Suspend a number
     */
    public function suspendNumber(int $numberId, string $reason = ''): bool
    {
        $number = Database::row('mod_phoneservices_numbers', '*', ['id' => $numberId]);
        if (!$number) {
            return false;
        }
        
        Database::update('mod_phoneservices_numbers', [
            'status' => 'suspended',
            'suspended_at' => date('Y-m-d H:i:s'),
            'suspend_reason' => $reason,
        ], ['id' => $numberId]);
        
        Logger::info('Number suspended', ['id' => $numberId, 'reason' => $reason]);
        return true;
    }
    
    /**
     * Release number back to pool
     */
    public function releaseNumber(int $numberId): bool
    {
        $number = Database::row('mod_phoneservices_numbers', '*', ['id' => $numberId]);
        if (!$number) {
            return false;
        }
        
        $provider = ProviderFactory::getProvider($number['provider']);
        if ($provider && $provider instanceof NumberProviderInterface) {
            $provider->releaseNumber($number['provider_id']);
        }
        
        Database::update('mod_phoneservices_numbers', [
            'status' => 'released',
            'released_at' => date('Y-m-d H:i:s'),
            'user_id' => 0,
            'assigned_service_id' => 0,
        ], ['id' => $numberId]);
        
        Logger::info('Number released', ['id' => $numberId]);
        return true;
    }
    
    /**
     * Get number details
     */
    public function getNumber(int $numberId): ?array
    {
        return Database::row('mod_phoneservices_numbers', '*', ['id' => $numberId]);
    }
    
    /**
     * Get all numbers for a user
     */
    public function getUserNumbers(int $userId): array
    {
        return Database::select('mod_phoneservices_numbers', '*', ['user_id' => $userId], 'id', 'DESC');
    }
    
    /**
     * Get all numbers (admin)
     */
    public function getAllNumbers(array $filters = []): array
    {
        $where = [];
        if (!empty($filters['status'])) {
            $where['status'] = $filters['status'];
        }
        if (!empty($filters['user_id'])) {
            $where['user_id'] = $filters['user_id'];
        }
        if (!empty($filters['country'])) {
            $where['country'] = strtoupper($filters['country']);
        }
        
        return Database::select('mod_phoneservices_numbers', '*', $where, 'id', 'DESC', $filters['limit'] ?? 100);
    }
    
    /**
     * Count user numbers
     */
    public function countUserNumbers(int $userId): int
    {
        return Database::count('mod_phoneservices_numbers', ['user_id' => $userId, 'status' => 'active']);
    }
    
    /**
     * Get available countries from provider
     */
    public function getAvailableCountries(): array
    {
        return [
            ['code' => 'US', 'name' => 'United States', 'flag' => '🇺🇸'],
            ['code' => 'GB', 'name' => 'United Kingdom', 'flag' => '🇬🇧'],
            ['code' => 'CA', 'name' => 'Canada', 'flag' => '🇨🇦'],
            ['code' => 'AU', 'name' => 'Australia', 'flag' => '🇦🇺'],
            ['code' => 'DE', 'name' => 'Germany', 'flag' => '🇩🇪'],
            ['code' => 'FR', 'name' => 'France', 'flag' => '🇫🇷'],
            ['code' => 'NL', 'name' => 'Netherlands', 'flag' => '🇳🇱'],
            ['code' => 'ES', 'name' => 'Spain', 'flag' => '🇪🇸'],
            ['code' => 'IT', 'name' => 'Italy', 'flag' => '🇮🇹'],
            ['code' => 'JP', 'name' => 'Japan', 'flag' => '🇯🇵'],
        ];
    }
    
    /**
     * Update number configuration
     */
    public function updateNumberConfig(int $numberId, array $config): bool
    {
        $number = Database::row('mod_phoneservices_numbers', '*', ['id' => $numberId]);
        if (!$number) {
            return false;
        }
        
        $provider = ProviderFactory::getProvider($number['provider']);
        if ($provider && $provider instanceof NumberProviderInterface) {
            $provider->updateNumberConfig($number['provider_id'], $config);
        }
        
        Database::update('mod_phoneservices_numbers', [
            'friendly_name' => $config['friendly_name'] ?? $number['friendly_name'],
            'voice_url' => $config['voice_url'] ?? $number['voice_url'],
            'sms_url' => $config['sms_url'] ?? $number['sms_url'],
        ], ['id' => $numberId]);
        
        return true;
    }
    
    /**
     * Get numbers requiring renewal
     */
    public function getRenewalDueNumbers(int $days = 7): array
    {
        $sql = "SELECT * FROM mod_phoneservices_numbers 
                WHERE status = 'active' 
                AND next_renewal <= DATE_ADD(NOW(), INTERVAL " . (int)$days . " DAY)";
        $result = full_query($sql);
        $numbers = [];
        while ($row = mysql_fetch_assoc($result)) {
            $numbers[] = $row;
        }
        return $numbers;
    }
}
