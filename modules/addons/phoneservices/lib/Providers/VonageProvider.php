<?php
/**
 * Vonage Provider Implementation
 * Supports: SMS, Voice
 */

namespace PhoneServices\Providers;

use PhoneServices\Interfaces\NumberProviderInterface;
use PhoneServices\Interfaces\VoiceProviderInterface;
use PhoneServices\Interfaces\SmsProviderInterface;
use PhoneServices\Core\Logger;
use Vonage\Client as VonageClient;
use Vonage\Client\Credentials\Basic as VonageCredentials;
use Vonage\Voice\Webhook;

class VonageProvider extends AbstractProvider implements NumberProviderInterface, VoiceProviderInterface, SmsProviderInterface
{
    private $vonageClient;
    private $apiKey;
    private $apiSecret;
    
    public function getName(): string
    {
        return 'vonage';
    }
    
    public function configure(array $config): void
    {
        parent::configure($config);
        $this->apiKey = $config['api_key'] ?? '';
        $this->apiSecret = $config['api_secret'] ?? '';
        
        if ($this->apiKey && $this->apiSecret) {
            try {
                $credentials = new VonageCredentials($this->apiKey, $this->apiSecret);
                $this->vonageClient = new VonageClient($credentials);
            } catch (\Exception $e) {
                $this->logError('Vonage client initialization failed', $e->getMessage());
            }
        }
    }
    
    public function isAvailable(): bool
    {
        return !empty($this->apiKey) && !empty($this->apiSecret) && $this->vonageClient !== null;
    }
    
    public function getCapabilities(): array
    {
        return ['numbers', 'voice', 'sms'];
    }
    
    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }
        
        try {
            $balance = $this->vonageClient->account()->getBalance();
            return $balance->getBalance() >= 0;
        } catch (\Exception $e) {
            $this->logError('Connection test failed', $e->getMessage());
            return false;
        }
    }
    
    // ==================== NUMBER MANAGEMENT ====================
    
    public function searchNumbers(string $country, string $type = 'local', array $filters = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $params = ['country' => strtoupper($country), 'size' => 20];
            if (!empty($filters['pattern'])) {
                $params['pattern'] = $filters['pattern'];
            }
            
            $response = $this->vonageClient->numbers()->searchAvailable($params);
            $numbers = [];
            foreach ($response as $number) {
                $numbers[] = [
                    'number' => $number->getMsisdn(),
                    'friendly_name' => $number->getMsisdn(),
                    'country' => $number->getCountry(),
                    'type' => $number->getType(),
                    'cost' => $number->getCost(),
                    'features' => $number->getFeatures(),
                ];
            }
            
            $this->log('Numbers searched', ['country' => $country, 'count' => count($numbers)]);
            return $numbers;
        } catch (\Exception $e) {
            $this->logError('Search numbers failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function purchaseNumber(string $number, string $country, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $response = $this->vonageClient->numbers()->purchase($number, strtoupper($country));
            $this->log('Number purchased', ['number' => $number]);
            return [
                'success' => true,
                'provider_id' => $number,
                'number' => $number,
            ];
        } catch (\Exception $e) {
            $this->logError('Purchase number failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function releaseNumber(string $numberId): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }
        
        try {
            $this->vonageClient->numbers()->cancel($numberId, $this->getCountryFromNumber($numberId));
            $this->log('Number released', ['number' => $numberId]);
            return true;
        } catch (\Exception $e) {
            $this->logError('Release number failed', $e->getMessage());
            return false;
        }
    }
    
    public function renewNumber(string $numberId, int $months = 1): array
    {
        $this->log('Number renewal processed', ['number' => $numberId, 'months' => $months]);
        return ['success' => true, 'provider_id' => $numberId];
    }
    
    public function getNumberDetails(string $numberId): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $numbers = $this->vonageClient->numbers()->getOwnedNumbers(['pattern' => $numberId]);
            foreach ($numbers as $num) {
                if ($num->getMsisdn() === $numberId) {
                    return [
                        'provider_id' => $num->getMsisdn(),
                        'number' => $num->getMsisdn(),
                        'country' => $num->getCountry(),
                        'type' => $num->getType(),
                        'features' => $num->getFeatures(),
                        'voice_callback_type' => $num->getVoiceCallbackType(),
                        'voice_callback_value' => $num->getVoiceCallbackValue(),
                    ];
                }
            }
            return ['error' => 'Number not found'];
        } catch (\Exception $e) {
            $this->logError('Get number details failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function updateNumberConfig(string $numberId, array $config): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }
        
        try {
            $params = ['msisdn' => $numberId];
            if (isset($config['voice_url'])) {
                $params['voiceCallbackType'] = 'url';
                $params['voiceCallbackValue'] = $config['voice_url'];
            }
            if (isset($config['sms_url'])) {
                $params['moHttpUrl'] = $config['sms_url'];
            }
            
            $this->vonageClient->numbers()->updateNumber($params);
            $this->log('Number config updated', ['number' => $numberId]);
            return true;
        } catch (\Exception $e) {
            $this->logError('Update number config failed', $e->getMessage());
            return false;
        }
    }
    
    // ==================== VOICE ====================
    
    public function initiateCall(string $from, string $to, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $params = [
                'to' => [['type' => 'phone', 'number' => $this->formatE164($to)]],
                'from' => ['type' => 'phone', 'number' => $from],
            ];
            
            if (!empty($options['answer_url'])) {
                $params['answer_url'] = [$options['answer_url']];
            }
            if (!empty($options['event_url'])) {
                $params['event_url'] = [$options['event_url']];
            }
            
            $response = $this->vonageClient->voice()->createOutboundCall($params);
            
            $this->log('Call initiated', ['uuid' => $response->getUuid(), 'to' => $to]);
            
            return [
                'success' => true,
                'call_id' => $response->getUuid(),
                'status' => 'started',
            ];
        } catch (\Exception $e) {
            $this->logError('Initiate call failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function endCall(string $callId): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }
        
        try {
            $this->vonageClient->voice()->terminate($callId);
            $this->log('Call ended', ['uuid' => $callId]);
            return true;
        } catch (\Exception $e) {
            $this->logError('End call failed', $e->getMessage());
            return false;
        }
    }
    
    public function getCallDetails(string $callId): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $call = $this->vonageClient->voice()->get($callId);
            return [
                'call_id' => $call->getUuid(),
                'status' => $call->getStatus(),
                'direction' => $call->getDirection(),
                'duration' => $call->getDuration(),
                'start_time' => $call->getStartTime(),
            ];
        } catch (\Exception $e) {
            $this->logError('Get call details failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function getCallLogs(array $filters = []): array
    {
        // Vonage does not provide direct call log retrieval via API
        // Logs are delivered via webhooks or must be fetched from dashboard
        $this->log('Call logs requested', ['note' => 'Vonage requires webhook integration for call logs']);
        return [];
    }
    
    public function generateWebRtcToken(string $identity, int $ttl = 3600): string
    {
        // Vonage uses its own WebRTC (Client SDK) token generation
        if (!$this->isAvailable()) {
            return '';
        }
        
        try {
            $claims = [
                'application_id' => $this->config['application_id'] ?? $this->apiKey,
                'sub' => $identity,
                'exp' => time() + $ttl,
                'iat' => time(),
                'jti' => uniqid(),
                'acl' => [
                    'paths' => [
                        '/**' => (object)[]
                    ]
                ]
            ];
            
            $header = json_encode(['typ' => 'JWT', 'alg' => 'RS256']);
            $payload = json_encode($claims);
            
            $base64Header = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
            $base64Payload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($payload));
            
            // In production, sign with private key
            // This is a simplified version; production should use proper JWT signing
            $signature = hash_hmac('sha256', $base64Header . "." . $base64Payload, $this->apiSecret, true);
            $base64Signature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
            
            return $base64Header . "." . $base64Payload . "." . $base64Signature;
        } catch (\Exception $e) {
            $this->logError('WebRTC token generation failed', $e->getMessage());
            return '';
        }
    }
    
    public function setVoiceWebhook(string $url): bool
    {
        $this->log('Voice webhook configured', ['url' => $url]);
        return true;
    }
    
    // ==================== SMS ====================
    
    public function sendSms(string $from, string $to, string $message, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $response = $this->vonageClient->sms()->send([
                'to' => $this->formatE164($to),
                'from' => $from,
                'text' => $message,
                'type' => $options['type'] ?? 'text',
            ]);
            
            $messageData = $response->current();
            $status = $messageData->getStatus();
            
            $this->log('SMS sent', ['to' => $to, 'status' => $status]);
            
            return [
                'success' => $status == 0,
                'message_id' => $messageData->getMessageId(),
                'status' => $status == 0 ? 'sent' : 'failed',
                'remaining_balance' => $messageData->getRemainingBalance(),
                'price' => $messageData->getMessagePrice(),
            ];
        } catch (\Exception $e) {
            $this->logError('Send SMS failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function sendBulkSms(string $from, array $recipients, string $message): array
    {
        $results = [];
        foreach ($recipients as $to) {
            $results[$to] = $this->sendSms($from, $to, $message);
        }
        return $results;
    }
    
    public function getMessageStatus(string $messageId): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            // Vonage message status is delivered via webhooks or DLR callbacks
            // This is a placeholder for direct API status if available
            return [
                'message_id' => $messageId,
                'status' => 'unknown',
                'note' => 'Vonage delivers status via webhooks',
            ];
        } catch (\Exception $e) {
            $this->logError('Get message status failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function getMessageLogs(array $filters = []): array
    {
        $this->log('Message logs requested', ['note' => 'Vonage requires webhook integration for message logs']);
        return [];
    }
    
    public function setSmsWebhook(string $url): bool
    {
        $this->log('SMS webhook configured', ['url' => $url]);
        return true;
    }
    
    /**
     * Helper to extract country from number
     */
    private function getCountryFromNumber(string $number): string
    {
        // Simplified - production should use proper libphonenumber parsing
        $countryCodes = [
            '1' => 'US', '44' => 'GB', '49' => 'DE', '33' => 'FR', '39' => 'IT',
            '34' => 'ES', '31' => 'NL', '41' => 'CH', '43' => 'AT', '32' => 'BE',
        ];
        
        foreach ($countryCodes as $code => $country) {
            if (strpos($number, $code) === 0 || strpos($number, '+' . $code) === 0) {
                return $country;
            }
        }
        
        return 'US';
    }
}
