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
        $this->provider = ProviderFactory::forCapability('voice', $providerName);
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
        $call = Database::row('mod_phoneservices_calls', '*', ['call_id' => $callId]);

        if (!$call) {
            Logger::warning('Status update for unknown call', ['call_id' => $callId]);
            return false;
        }

        $update = ['status' => $status];

        if (isset($metadata['duration'])) {
            $update['duration'] = (int) $metadata['duration'];
        }

        // Providers report cost under different keys.
        foreach (['cost', 'price'] as $costKey) {
            if (isset($metadata[$costKey]) && (float) $metadata[$costKey] > 0) {
                $update['cost'] = abs((float) $metadata[$costKey]);
                break;
            }
        }

        if (!empty($metadata['recording_url'])) {
            $update['recording_url'] = $metadata['recording_url'];
        }

        $terminal = in_array($status, ['ended', 'completed', 'failed'], true);

        if ($terminal) {
            $update['ended_at'] = date('Y-m-d H:i:s');

            // Fall back to our own rate card when the provider gives no price.
            $duration = (int) ($update['duration'] ?? $call['duration'] ?? 0);

            if (empty($update['cost']) && $duration > 0) {
                $update['cost'] = $this->calculateCallCost(
                    (string) $call['to_number'],
                    $duration,
                    (string) ($call['direction'] ?? 'outbound')
                );
            }
        }

        Database::update('mod_phoneservices_calls', $update, ['call_id' => $callId]);

        // Meter the call exactly once, when it reaches a terminal state.
        if ($terminal && (string) $call['status'] !== $status && (int) ($update['duration'] ?? 0) > 0) {
            $usageService = new UsageService();
            $usageService->recordUsage(
                (int) $call['user_id'],
                'call',
                (int) $call['id'],
                round(((int) $update['duration']) / 60, 4),
                null,
                'minute'
            );

            if (!empty($update['cost'])) {
                $usageService->createTransaction(
                    (int) $call['user_id'],
                    'call',
                    (int) $call['id'],
                    (float) $update['cost'],
                    (string) Config::get('currency', 'USD'),
                    'completed'
                );
            }
        }

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
        $where = ['user_id' => $userId];

        foreach (['status', 'direction', 'from_number', 'to_number'] as $column) {
            if (!empty($filters[$column])) {
                $where[$column] = $filters[$column];
            }
        }

        return Database::select('mod_phoneservices_calls', '*', $where, 'id', 'DESC', (int) ($filters['limit'] ?? 50));
    }

    /**
     * Aggregate call metrics for the admin VoIP screen.
     *
     * @return array<string,mixed>
     */
    public function getCallStatistics(array $filters = []): array
    {
        $sql = 'SELECT COUNT(*) AS total,
                       COALESCE(SUM(duration),0) AS total_seconds,
                       COALESCE(SUM(cost),0) AS total_cost,
                       COALESCE(AVG(NULLIF(duration,0)),0) AS avg_seconds,
                       SUM(CASE WHEN status = "failed" THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN direction = "inbound" THEN 1 ELSE 0 END) AS inbound,
                       SUM(CASE WHEN direction = "outbound" THEN 1 ELSE 0 END) AS outbound
                  FROM mod_phoneservices_calls
                 WHERE 1 = 1';
        $bindings = [];

        if (!empty($filters['user_id'])) {
            $sql .= ' AND user_id = ?';
            $bindings[] = (int) $filters['user_id'];
        }
        if (!empty($filters['from'])) {
            $sql .= ' AND started_at >= ?';
            $bindings[] = date('Y-m-d 00:00:00', strtotime((string) $filters['from']));
        }

        $row = Database::raw($sql, $bindings)[0] ?? [];

        return [
            'total'         => (int) ($row['total'] ?? 0),
            'total_minutes' => round(((float) ($row['total_seconds'] ?? 0)) / 60, 2),
            'total_cost'    => round((float) ($row['total_cost'] ?? 0), 4),
            'avg_seconds'   => round((float) ($row['avg_seconds'] ?? 0), 1),
            'failed'        => (int) ($row['failed'] ?? 0),
            'inbound'       => (int) ($row['inbound'] ?? 0),
            'outbound'      => (int) ($row['outbound'] ?? 0),
        ];
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

    /**
     * Record an inbound call arriving on one of our numbers.
     *
     * @param array<string,mixed> $data
     */
    public function registerInboundCall(array $data): int
    {
        $callId = (string) ($data['call_id'] ?? '');

        if ($callId === '') {
            return 0;
        }

        $existing = Database::row('mod_phoneservices_calls', 'id', ['call_id' => $callId]);

        if ($existing) {
            $this->updateCallStatus($callId, (string) ($data['status'] ?? 'ringing'), $data);

            return (int) $existing['id'];
        }

        $number = Database::row('mod_phoneservices_numbers', '*', ['number' => (string) ($data['to'] ?? '')]);

        $id = Database::insert('mod_phoneservices_calls', [
            'user_id'     => (int) ($number['user_id'] ?? 0),
            'provider'    => (string) ($data['provider'] ?? 'unknown'),
            'call_id'     => $callId,
            'from_number' => (string) ($data['from'] ?? ''),
            'to_number'   => (string) ($data['to'] ?? ''),
            'direction'   => (string) ($data['direction'] ?? 'inbound'),
            'status'      => (string) ($data['status'] ?? 'ringing'),
            'started_at'  => date('Y-m-d H:i:s'),
            'cost'        => 0,
        ]);

        Logger::info('Inbound call registered', ['call_id' => $callId, 'number' => $data['to'] ?? '']);

        return $id;
    }

    /**
     * TwiML for an inbound call: ring the browser client that owns the number,
     * otherwise fall back to the client's forwarding number or voicemail.
     */
    public function buildInboundTwiml(string $toNumber, string $fromNumber): string
    {
        $number = Database::row('mod_phoneservices_numbers', '*', ['number' => $toNumber, 'status' => 'active']);
        $xml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

        if ($number) {
            $forward = (string) ($number['forward_to'] ?? '');
            $callerId = htmlspecialchars($toNumber, ENT_QUOTES | ENT_XML1, 'UTF-8');

            if ($forward !== '') {
                $xml .= '<Dial callerId="' . $callerId . '" timeout="25">'
                    . '<Number>' . htmlspecialchars($forward, ENT_QUOTES | ENT_XML1, 'UTF-8') . '</Number></Dial>';
            } else {
                $xml .= '<Dial callerId="' . $callerId . '" timeout="25">'
                    . '<Client>user_' . (int) $number['user_id'] . '</Client></Dial>';
            }
        }

        $xml .= '<Say>The person you are calling is unavailable. Please try again later.</Say>';
        $xml .= '</Response>';

        return $xml;
    }

    /**
     * Vonage NCCO equivalent of buildInboundTwiml().
     *
     * @return array<int,array<string,mixed>>
     */
    public function buildInboundNcco(string $toNumber, string $fromNumber): array
    {
        $number = Database::row('mod_phoneservices_numbers', '*', ['number' => '+' . ltrim($toNumber, '+'), 'status' => 'active']);

        if ($number && !empty($number['forward_to'])) {
            return [[
                'action'   => 'connect',
                'from'     => ltrim($toNumber, '+'),
                'endpoint' => [['type' => 'phone', 'number' => ltrim((string) $number['forward_to'], '+')]],
            ]];
        }

        if ($number) {
            return [[
                'action'   => 'connect',
                'from'     => ltrim($toNumber, '+'),
                'endpoint' => [['type' => 'app', 'user' => 'user_' . (int) $number['user_id']]],
            ]];
        }

        return [[
            'action' => 'talk',
            'text'   => 'The person you are calling is unavailable. Please try again later.',
        ]];
    }
}
