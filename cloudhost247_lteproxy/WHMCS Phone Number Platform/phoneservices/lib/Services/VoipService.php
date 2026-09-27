<?php
/**
 * VoIP Service
 * Handles WebRTC calling, call logs, and voice lifecycle
 */

namespace PhoneServices\Services;

use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Config;
use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Interfaces\VoiceProviderInterface;

class VoipService
{
    private $provider;
    
    public function __construct(string $providerName = null)
    {
        $this->provider = ProviderFactory::getProviderForService('voice', $providerName);
    }
    
    /**
     * Initiate a call
     */
    public function initiateCall(int $userId, string $from, string $to, array $options = []): array
    {
        if (!$this->provider || !($this->provider instanceof VoiceProviderInterface)) {
            return ['error' => 'Voice provider not available'];
        }
        
        $result = $this->provider->initiateCall($from, $to, $options);
        
        if (!isset($result['error'])) {
            $record = [
                'user_id' => $userId,
                'provider' => $this->provider->getName(),
                'call_id' => $result['call_id'],
                'from_number' => $from,
                'to_number' => $to,
                'direction' => 'outbound',
                'status' => $result['status'] ?? 'initiated',
                'started_at' => date('Y-m-d H:i:s'),
                'cost' => 0,
            ];
            Database::insert('mod_phoneservices_calls', $record);
            Logger::info('Call initiated', ['user' => $userId, 'call_id' => $result['call_id']]);
        }
        
        return $result;
    }
    
    /**
     * End an active call
     */
    public function endCall(int $userId, string $callId): bool
    {
        if (!$this->provider || !($this->provider instanceof VoiceProviderInterface)) {
            return false;
        }
        
        $result = $this->provider->endCall($callId);
        
        if ($result) {
            Database::update('mod_phoneservices_calls', [
                'status' => 'ended',
                'ended_at' => date('Y-m-d H:i:s'),
            ], ['call_id' => $callId, 'user_id' => $userId]);
            Logger::info('Call ended', ['call_id' => $callId]);
        }
        
        return $result;
    }
    
    /**
     * Update call status from webhook
     */
    public function updateCallStatus(string $callId, string $status, array $metadata = []): bool
    {
        $update = ['status' => $status];
        
        if (!empty($metadata['duration'])) {
            $update['duration'] = (int) $metadata['duration'];
        }
        if (!empty($metadata['price'])) {
            $update['cost'] = (float) $metadata['price'];
        }
        if ($status === 'completed' || $status === 'ended' || $status === 'failed') {
            $update['ended_at'] = date('Y-m-d H:i:s');
        }
        if (!empty($metadata['recording_url'])) {
            $update['recording_url'] = $metadata['recording_url'];
        }
        
        Database::update('mod_phoneservices_calls', $update, ['call_id' => $callId]);
        
        Logger::info('Call status updated', ['call_id' => $callId, 'status' => $status]);
        return true;
    }
    
    /**
     * Get call details
     */
    public function getCallDetails(string $callId): array
    {
        if (!$this->provider || !($this->provider instanceof VoiceProviderInterface)) {
            return ['error' => 'Voice provider not available'];
        }
        
        return $this->provider->getCallDetails($callId);
    }
    
    /**
     * Get call logs for a user
     */
    public function getUserCallLogs(int $userId, array $filters = []): array
    {
        return Database::select('mod_phoneservices_calls', '*', array_merge(['user_id' => $userId], $filters), 'id', 'DESC', $filters['limit'] ?? 50);
    }
    
    /**
     * Get all call logs (admin)
     */
    public function getAllCallLogs(array $filters = []): array
    {
        $where = [];
        if (!empty($filters['status'])) {
            $where['status'] = $filters['status'];
        }
        if (!empty($filters['user_id'])) {
            $where['user_id'] = $filters['user_id'];
        }
        if (!empty($filters['direction'])) {
            $where['direction'] = $filters['direction'];
        }
        
        return Database::select('mod_phoneservices_calls', '*', $where, 'id', 'DESC', $filters['limit'] ?? 100);
    }
    
    /**
     * Generate WebRTC token for client
     */
    public function getWebRtcConfig(int $userId): array
    {
        if (!$this->provider || !($this->provider instanceof VoiceProviderInterface)) {
            return ['error' => 'Voice provider not available'];
        }
        
        $identity = 'user_' . $userId;
        $token = $this->provider->generateWebRtcToken($identity, 3600);
        
        return [
            'token' => $token,
            'identity' => $identity,
            'provider' => $this->provider->getName(),
            'ttl' => 3600,
        ];
    }
    
    /**
     * Get active calls for user
     */
    public function getActiveCalls(int $userId): array
    {
        return Database::select('mod_phoneservices_calls', '*', [
            'user_id' => $userId,
            'status' => ['sql' => "status IN ('initiated', 'ringing', 'in-progress', 'connected')"]
        ], 'id', 'DESC');
    }
    
    /**
     * Calculate call cost
     */
    public function calculateCallCost(string $to, int $durationSeconds, string $direction = 'outbound'): float
    {
        $baseRate = 0.013; // $0.013/min base rate
        $durationMinutes = ceil($durationSeconds / 60);
        
        // Country-specific rates would be loaded from pricing table
        $rate = $baseRate;
        
        $pricing = Database::row('mod_phoneservices_pricing', '*', [
            'service_type' => 'voice',
            'country' => substr($to, 0, 2),
        ]);
        
        if ($pricing && !empty($pricing['rate_per_minute'])) {
            $rate = (float) $pricing['rate_per_minute'];
        }
        
        return round($durationMinutes * $rate, 4);
    }
    
    /**
     * Sync call logs from provider
     */
    public function syncCallLogs(int $userId = null): array
    {
        if (!$this->provider || !($this->provider instanceof VoiceProviderInterface)) {
            return ['error' => 'Voice provider not available'];
        }
        
        $filters = [];
        if ($userId) {
            // Get user's numbers for filtering
            $numbers = Database::select('mod_phoneservices_numbers', 'number', ['user_id' => $userId]);
            if ($numbers) {
                $filters['from'] = $numbers[0]['number'];
            }
        }
        
        $logs = $this->provider->getCallLogs($filters);
        $synced = 0;
        
        if (is_array($logs) && !isset($logs['error'])) {
            foreach ($logs as $log) {
                $existing = Database::row('mod_phoneservices_calls', 'id', ['call_id' => $log['call_id']]);
                if (!$existing) {
                    Database::insert('mod_phoneservices_calls', [
                        'user_id' => $userId ?? 0,
                        'provider' => $this->provider->getName(),
                        'call_id' => $log['call_id'],
                        'from_number' => $log['from'],
                        'to_number' => $log['to'],
                        'direction' => $log['direction'],
                        'status' => $log['status'],
                        'duration' => $log['duration'] ?? 0,
                        'cost' => abs((float) ($log['price'] ?? 0)),
                        'started_at' => $log['start_time'],
                    ]);
                    $synced++;
                }
            }
        }
        
        Logger::info('Call logs synced', ['synced' => $synced]);
        return ['synced' => $synced];
    }
}
