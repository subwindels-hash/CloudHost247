<?php
/**
 * eSIM Service
 * Handles eSIM purchase, activation, QR codes, and data plan lifecycle
 */

namespace PhoneServices\Services;

use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Config;
use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Interfaces\EsimProviderInterface;
use Endroid\QrCode\QrCode;
use Endroid\QrCode\Writer\PngWriter;

class EsimService
{
    private $provider;
    
    public function __construct(string $providerName = null)
    {
        $this->provider = ProviderFactory::getProviderForService('esim', $providerName);
    }
    
    /**
     * Get available eSIM plans
     */
    public function getAvailablePlans(string $country = null, string $region = null): array
    {
        if (!$this->provider || !($this->provider instanceof EsimProviderInterface)) {
            return ['error' => 'eSIM provider not available'];
        }
        
        return $this->provider->getPlans($country, $region);
    }
    
    /**
     * Purchase eSIM plan
     */
    public function purchasePlan(int $userId, string $planId, array $options = []): array
    {
        if (!$this->provider || !($this->provider instanceof EsimProviderInterface)) {
            return ['error' => 'eSIM provider not available'];
        }
        
        $user = Database::row('tblclients', 'email, phonenumber', ['id' => $userId]);
        if ($user) {
            $options['email'] = $user['email'];
            $options['phone_number'] = $user['phonenumber'];
        }
        
        $result = $this->provider->purchasePlan($planId, $options);
        
        if (isset($result['error'])) {
            Logger::error('eSIM purchase failed', ['user' => $userId, 'error' => $result['error']]);
            return $result;
        }
        
        $record = [
            'user_id' => $userId,
            'provider' => $this->provider->getName(),
            'provider_esim_id' => $result['esim_id'] ?? '',
            'order_id' => $result['order_id'] ?? '',
            'plan_id' => $planId,
            'iccid' => $result['iccid'] ?? '',
            'lpa_code' => $result['lpa_code'] ?? $result['activation_code'] ?? '',
            'qr_code_data' => $result['qr_code_data'] ?? '',
            'status' => $result['status'] ?? 'pending',
            'friendly_name' => $options['friendly_name'] ?? 'eSIM',
            'purchased_at' => date('Y-m-d H:i:s'),
            'expires_at' => date('Y-m-d H:i:s', strtotime('+30 days')), // Default
        ];
        
        $id = Database::insert('mod_phoneservices_esims', $record);
        
        Logger::info('eSIM purchased', ['id' => $id, 'user' => $userId, 'plan' => $planId]);
        
        return array_merge($result, ['id' => $id]);
    }
    
    /**
     * Activate eSIM
     */
    public function activateEsim(int $esimId): array
    {
        $esim = Database::row('mod_phoneservices_esims', '*', ['id' => $esimId]);
        if (!$esim) {
            return ['error' => 'eSIM not found'];
        }
        
        $provider = ProviderFactory::getProvider($esim['provider']);
        if ($provider && $provider instanceof EsimProviderInterface) {
            $details = $provider->getEsimDetails($esim['provider_esim_id']);
            if (!isset($details['error'])) {
                Database::update('mod_phoneservices_esims', [
                    'status' => 'active',
                    'activated_at' => date('Y-m-d H:i:s'),
                    'expires_at' => $details['expires_at'] ?? $esim['expires_at'],
                ], ['id' => $esimId]);
                
                Logger::info('eSIM activated', ['id' => $esimId]);
                return ['success' => true, 'status' => 'active'];
            }
            return $details;
        }
        
        return ['error' => 'Provider not available'];
    }
    
    /**
     * Get QR code for eSIM
     */
    public function getQrCode(int $esimId): array
    {
        $esim = Database::row('mod_phoneservices_esims', '*', ['id' => $esimId]);
        if (!$esim) {
            return ['error' => 'eSIM not found'];
        }
        
        $qrData = $esim['qr_code_data'];
        
        if (empty($qrData)) {
            $provider = ProviderFactory::getProvider($esim['provider']);
            if ($provider && $provider instanceof EsimProviderInterface) {
                $qrData = $provider->getQrCodeData($esim['provider_esim_id']);
            }
        }
        
        if (empty($qrData) && !empty($esim['lpa_code'])) {
            $qrData = $esim['lpa_code'];
        }
        
        if (empty($qrData)) {
            return ['error' => 'No provisioning data available'];
        }
        
        try {
            $writer = new PngWriter();
            $qrCode = QrCode::create($qrData)
                ->setSize(400)
                ->setMargin(10);
            
            $result = $writer->write($qrCode);
            $base64 = base64_encode($result->getString());
            
            return [
                'success' => true,
                'qr_data' => $qrData,
                'qr_base64' => 'data:image/png;base64,' . $base64,
                'lpa_code' => $esim['lpa_code'],
            ];
        } catch (\Exception $e) {
            Logger::error('QR generation failed', ['error' => $e->getMessage()]);
            return ['error' => $e->getMessage(), 'qr_data' => $qrData];
        }
    }
    
    /**
     * Check data usage
     */
    public function checkUsage(int $esimId): array
    {
        $esim = Database::row('mod_phoneservices_esims', '*', ['id' => $esimId]);
        if (!$esim) {
            return ['error' => 'eSIM not found'];
        }
        
        $provider = ProviderFactory::getProvider($esim['provider']);
        if ($provider && $provider instanceof EsimProviderInterface) {
            $usage = $provider->checkUsage($esim['provider_esim_id']);
            
            if (!isset($usage['error'])) {
                Database::insert('mod_phoneservices_usage', [
                    'user_id' => $esim['user_id'],
                    'service_type' => 'esim_data',
                    'reference_id' => $esimId,
                    'used_value' => $usage['used_data_mb'] ?? $usage['used_data'] ?? 0,
                    'total_value' => $usage['total_data_mb'] ?? $usage['total_data'] ?? 0,
                    'unit' => 'MB',
                    'recorded_at' => date('Y-m-d H:i:s'),
                ]);
                
                return $usage;
            }
            return $usage;
        }
        
        return ['error' => 'Provider not available'];
    }
    
    /**
     * Top up eSIM
     */
    public function topUp(int $esimId, string $planId): array
    {
        $esim = Database::row('mod_phoneservices_esims', '*', ['id' => $esimId]);
        if (!$esim) {
            return ['error' => 'eSIM not found'];
        }
        
        $provider = ProviderFactory::getProvider($esim['provider']);
        if ($provider && $provider instanceof EsimProviderInterface) {
            $result = $provider->topUp($esim['provider_esim_id'], $planId);
            
            if (!isset($result['error'])) {
                Database::insert('mod_phoneservices_transactions', [
                    'user_id' => $esim['user_id'],
                    'service_type' => 'esim_topup',
                    'reference_id' => $esimId,
                    'amount' => 0, // Would be fetched from plan pricing
                    'currency' => 'USD',
                    'status' => 'completed',
                    'created_at' => date('Y-m-d H:i:s'),
                ]);
                
                Logger::info('eSIM topped up', ['id' => $esimId, 'plan' => $planId]);
            }
            
            return $result;
        }
        
        return ['error' => 'Provider not available'];
    }
    
    /**
     * Expire eSIM (scheduled task)
     */
    public function expireEsim(int $esimId): bool
    {
        $esim = Database::row('mod_phoneservices_esims', '*', ['id' => $esimId]);
        if (!$esim) {
            return false;
        }
        
        Database::update('mod_phoneservices_esims', [
            'status' => 'expired',
            'expired_at' => date('Y-m-d H:i:s'),
        ], ['id' => $esimId]);
        
        Logger::info('eSIM expired', ['id' => $esimId]);
        return true;
    }
    
    /**
     * Renew eSIM plan
     */
    public function renewEsim(int $esimId, string $planId): array
    {
        $esim = Database::row('mod_phoneservices_esims', '*', ['id' => $esimId]);
        if (!$esim) {
            return ['error' => 'eSIM not found'];
        }
        
        $result = $this->topUp($esimId, $planId);
        
        if (!isset($result['error'])) {
            Database::update('mod_phoneservices_esims', [
                'status' => 'active',
                'renewed_at' => date('Y-m-d H:i:s'),
            ], ['id' => $esimId]);
        }
        
        return $result;
    }
    
    /**
     * Get user eSIMs
     */
    public function getUserProfiles(int $userId): array
    {
        return Database::select('mod_phoneservices_esims', '*', ['user_id' => $userId], 'id', 'DESC');
    }
    
    /**
     * Get all eSIMs (admin)
     */
    public function getAllProfiles(array $filters = []): array
    {
        $where = [];
        if (!empty($filters['status'])) {
            $where['status'] = $filters['status'];
        }
        if (!empty($filters['user_id'])) {
            $where['user_id'] = $filters['user_id'];
        }
        
        return Database::select('mod_phoneservices_esims', '*', $where, 'id', 'DESC', $filters['limit'] ?? 100);
    }
    
    /**
     * Get eSIM details
     */
    public function getEsimDetails(int $esimId): ?array
    {
        return Database::row('mod_phoneservices_esims', '*', ['id' => $esimId]);
    }
    
    /**
     * Get expiring eSIMs
     */
    public function getExpiringEsims(int $days = 7): array
    {
        $sql = "SELECT * FROM mod_phoneservices_esims 
                WHERE status = 'active' 
                AND expires_at <= DATE_ADD(NOW(), INTERVAL " . (int)$days . " DAY)";
        $result = full_query($sql);
        $esims = [];
        while ($row = mysql_fetch_assoc($result)) {
            $esims[] = $row;
        }
        return $esims;
    }
}
