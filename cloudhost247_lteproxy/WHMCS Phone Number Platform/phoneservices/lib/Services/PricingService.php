<?php
/**
 * Pricing Service
 * Handles pricing rules per country and service type
 */

namespace PhoneServices\Services;

use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;

class PricingService
{
    /**
     * Get pricing for a service type and country
     */
    public function getPricing(string $serviceType, string $country = null): ?array
    {
        $where = ['service_type' => $serviceType];
        if ($country) {
            $where['country'] = strtoupper($country);
        }
        
        return Database::row('mod_phoneservices_pricing', '*', $where);
    }
    
    /**
     * Get all pricing rules
     */
    public function getAllPricing(array $filters = []): array
    {
        $where = [];
        if (!empty($filters['service_type'])) {
            $where['service_type'] = $filters['service_type'];
        }
        if (!empty($filters['country'])) {
            $where['country'] = strtoupper($filters['country']);
        }
        
        return Database::select('mod_phoneservices_pricing', '*', $where, 'id', 'ASC', $filters['limit'] ?? 500);
    }
    
    /**
     * Update or create pricing
     */
    public function updatePricing(array $data): bool
    {
        if (empty($data['pricing']) || !is_array($data['pricing'])) {
            return false;
        }
        
        foreach ($data['pricing'] as $item) {
            if (empty($item['service_type']) || empty($item['country'])) {
                continue;
            }
            
            $record = [
                'service_type' => $item['service_type'],
                'country' => strtoupper($item['country']),
                'rate_per_minute' => !empty($item['rate_per_minute']) ? (float) $item['rate_per_minute'] : 0,
                'rate_per_unit' => !empty($item['rate_per_unit']) ? (float) $item['rate_per_unit'] : 0,
                'monthly_cost' => !empty($item['monthly_cost']) ? (float) $item['monthly_cost'] : 0,
                'setup_cost' => !empty($item['setup_cost']) ? (float) $item['setup_cost'] : 0,
                'currency' => $item['currency'] ?? 'USD',
                'updated_at' => date('Y-m-d H:i:s'),
            ];
            
            $existing = Database::row('mod_phoneservices_pricing', 'id', [
                'service_type' => $record['service_type'],
                'country' => $record['country'],
            ]);
            
            if ($existing) {
                Database::update('mod_phoneservices_pricing', $record, ['id' => $existing['id']]);
            } else {
                $record['created_at'] = date('Y-m-d H:i:s');
                Database::insert('mod_phoneservices_pricing', $record);
            }
        }
        
        Logger::info('Pricing updated', ['items' => count($data['pricing'])]);
        return true;
    }
    
    /**
     * Delete pricing rule
     */
    public function deletePricing(int $id): bool
    {
        Database::delete('mod_phoneservices_pricing', ['id' => $id]);
        Logger::info('Pricing deleted', ['id' => $id]);
        return true;
    }
    
    /**
     * Calculate cost for a service usage
     */
    public function calculateCost(string $serviceType, string $country, float $quantity, string $unit = 'minute'): float
    {
        $pricing = $this->getPricing($serviceType, $country);
        
        if (!$pricing) {
            // Fallback to default
            $pricing = $this->getPricing($serviceType, 'DEFAULT');
        }
        
        if (!$pricing) {
            return 0;
        }
        
        $rate = 0;
        switch ($unit) {
            case 'minute':
                $rate = (float) ($pricing['rate_per_minute'] ?? 0);
                break;
            case 'unit':
            case 'message':
                $rate = (float) ($pricing['rate_per_unit'] ?? 0);
                break;
            case 'month':
                $rate = (float) ($pricing['monthly_cost'] ?? 0);
                break;
            case 'setup':
                $rate = (float) ($pricing['setup_cost'] ?? 0);
                $quantity = 1;
                break;
        }
        
        return round($rate * $quantity, 4);
    }
    
    /**
     * Bulk import pricing from CSV/array
     */
    public function importPricing(array $rows): array
    {
        $imported = 0;
        $failed = 0;
        
        foreach ($rows as $row) {
            if (empty($row['service_type']) || empty($row['country'])) {
                $failed++;
                continue;
            }
            
            $record = [
                'service_type' => trim($row['service_type']),
                'country' => strtoupper(trim($row['country'])),
                'rate_per_minute' => !empty($row['rate_per_minute']) ? (float) $row['rate_per_minute'] : 0,
                'rate_per_unit' => !empty($row['rate_per_unit']) ? (float) $row['rate_per_unit'] : 0,
                'monthly_cost' => !empty($row['monthly_cost']) ? (float) $row['monthly_cost'] : 0,
                'setup_cost' => !empty($row['setup_cost']) ? (float) $row['setup_cost'] : 0,
                'currency' => $row['currency'] ?? 'USD',
                'created_at' => date('Y-m-d H:i:s'),
                'updated_at' => date('Y-m-d H:i:s'),
            ];
            
            $existing = Database::row('mod_phoneservices_pricing', 'id', [
                'service_type' => $record['service_type'],
                'country' => $record['country'],
            ]);
            
            if ($existing) {
                Database::update('mod_phoneservices_pricing', $record, ['id' => $existing['id']]);
            } else {
                Database::insert('mod_phoneservices_pricing', $record);
            }
            $imported++;
        }
        
        Logger::info('Pricing imported', ['imported' => $imported, 'failed' => $failed]);
        return ['imported' => $imported, 'failed' => $failed];
    }
}
