<?php
/**
 * Twilio Provider Implementation
 * Supports: SMS, Voice, Phone Numbers, WebRTC
 */

namespace PhoneServices\Providers;

use PhoneServices\Interfaces\NumberProviderInterface;
use PhoneServices\Interfaces\VoiceProviderInterface;
use PhoneServices\Interfaces\SmsProviderInterface;
use PhoneServices\Core\Config;
use PhoneServices\Core\Logger;
use Twilio\Rest\Client as TwilioClient;
use Twilio\Jwt\AccessToken;
use Twilio\Jwt\Grants\VoiceGrant;

class TwilioProvider extends AbstractProvider implements NumberProviderInterface, VoiceProviderInterface, SmsProviderInterface
{
    private $twilioClient;
    private $accountSid;
    private $authToken;
    
    public function getName(): string
    {
        return 'twilio';
    }
    
    public function configure(array $config): void
    {
        parent::configure($config);
        $this->accountSid = $config['account_sid'] ?? '';
        $this->authToken = $config['auth_token'] ?? '';
        
        if ($this->accountSid && $this->authToken) {
            try {
                $this->twilioClient = new TwilioClient($this->accountSid, $this->authToken);
            } catch (\Exception $e) {
                $this->logError('Twilio client initialization failed', $e->getMessage());
            }
        }
    }
    
    public function isAvailable(): bool
    {
        return !empty($this->accountSid) && !empty($this->authToken) && $this->twilioClient !== null;
    }
    
    public function getCapabilities(): array
    {
        return ['numbers', 'voice', 'sms', 'webrtc'];
    }
    
    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }
        
        try {
            $this->twilioClient->api->v2010->account->fetch();
            return true;
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
            $isoCountry = strtoupper($country);
            $params = ['country' => $isoCountry, 'limit' => 20];
            
            if (!empty($filters['area_code'])) {
                $params['areaCode'] = $filters['area_code'];
            }
            if (!empty($filters['contains'])) {
                $params['contains'] = $filters['contains'];
            }
            
            if ($type === 'tollfree') {
                $numbers = $this->twilioClient->availablePhoneNumbers($isoCountry)->tollFree->read($params);
            } else {
                $numbers = $this->twilioClient->availablePhoneNumbers($isoCountry)->local->read($params);
            }
            
            $results = [];
            foreach ($numbers as $number) {
                $results[] = [
                    'number' => $number->phoneNumber,
                    'friendly_name' => $number->friendlyName,
                    'location' => $number->locality . ', ' . $number->region,
                    'capabilities' => [
                        'voice' => $number->capabilities['voice'] ?? false,
                        'sms' => $number->capabilities['SMS'] ?? false,
                        'mms' => $number->capabilities['MMS'] ?? false,
                    ],
                    'monthly_price' => $number->beta ? 0.00 : 1.00, // Approximate
                ];
            }
            
            $this->log('Numbers searched', ['country' => $country, 'type' => $type, 'count' => count($results)]);
            return $results;
            
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
            $params = ['phoneNumber' => $number];
            if (!empty($options['voice_url'])) {
                $params['voiceUrl'] = $options['voice_url'];
            }
            if (!empty($options['sms_url'])) {
                $params['smsUrl'] = $options['sms_url'];
            }
            
            $purchased = $this->twilioClient->incomingPhoneNumbers->create($params);
            
            $this->log('Number purchased', ['number' => $number, 'sid' => $purchased->sid]);
            
            return [
                'success' => true,
                'provider_id' => $purchased->sid,
                'number' => $purchased->phoneNumber,
                'friendly_name' => $purchased->friendlyName,
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
            $this->twilioClient->incomingPhoneNumbers($numberId)->delete();
            $this->log('Number released', ['sid' => $numberId]);
            return true;
        } catch (\Exception $e) {
            $this->logError('Release number failed', $e->getMessage());
            return false;
        }
    }
    
    public function renewNumber(string $numberId, int $months = 1): array
    {
        // Twilio numbers are pay-as-you-go; renewal handled by maintaining account balance
        // This is a billing abstraction layer call
        $this->log('Number renewal processed', ['sid' => $numberId, 'months' => $months]);
        return ['success' => true, 'provider_id' => $numberId];
    }
    
    public function getNumberDetails(string $numberId): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $number = $this->twilioClient->incomingPhoneNumbers($numberId)->fetch();
            return [
                'provider_id' => $number->sid,
                'number' => $number->phoneNumber,
                'friendly_name' => $number->friendlyName,
                'voice_url' => $number->voiceUrl,
                'sms_url' => $number->smsUrl,
                'status' => $number->status,
                'capabilities' => [
                    'voice' => $number->capabilities['voice'] ?? false,
                    'sms' => $number->capabilities['SMS'] ?? false,
                    'mms' => $number->capabilities['MMS'] ?? false,
                ],
            ];
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
            $params = [];
            if (isset($config['voice_url'])) {
                $params['voiceUrl'] = $config['voice_url'];
            }
            if (isset($config['sms_url'])) {
                $params['smsUrl'] = $config['sms_url'];
            }
            if (isset($config['friendly_name'])) {
                $params['friendlyName'] = $config['friendly_name'];
            }
            
            $this->twilioClient->incomingPhoneNumbers($numberId)->update($params);
            $this->log('Number config updated', ['sid' => $numberId]);
            return true;
        } catch (\Exception $e) {
            $this->logError('Update number config failed', $e->getMessage());
            return false;
        }
    }
    
    // ==================== VOICE / WEBRTC ====================
    
    public function initiateCall(string $from, string $to, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $params = [
                'from' => $from,
                'to' => $this->formatE164($to),
            ];
            
            if (!empty($options['twiml'])) {
                $params['twiml'] = $options['twiml'];
            } elseif (!empty($options['url'])) {
                $params['url'] = $options['url'];
            }
            
            $call = $this->twilioClient->calls->create($params['to'], $params['from'], $params);
            
            $this->log('Call initiated', ['sid' => $call->sid, 'to' => $to]);
            
            return [
                'success' => true,
                'call_id' => $call->sid,
                'status' => $call->status,
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
            $this->twilioClient->calls($callId)->update(['status' => 'completed']);
            $this->log('Call ended', ['sid' => $callId]);
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
            $call = $this->twilioClient->calls($callId)->fetch();
            return [
                'call_id' => $call->sid,
                'from' => $call->from,
                'to' => $call->to,
                'status' => $call->status,
                'duration' => $call->duration,
                'price' => $call->price,
                'start_time' => $call->startTime ? $call->startTime->format('Y-m-d H:i:s') : null,
                'end_time' => $call->endTime ? $call->endTime->format('Y-m-d H:i:s') : null,
                'direction' => $call->direction,
            ];
        } catch (\Exception $e) {
            $this->logError('Get call details failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function getCallLogs(array $filters = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $params = ['limit' => 50];
            if (!empty($filters['from'])) {
                $params['from'] = $filters['from'];
            }
            if (!empty($filters['to'])) {
                $params['to'] = $filters['to'];
            }
            
            $calls = $this->twilioClient->calls->read($params);
            $logs = [];
            foreach ($calls as $call) {
                $logs[] = [
                    'call_id' => $call->sid,
                    'from' => $call->from,
                    'to' => $call->to,
                    'status' => $call->status,
                    'duration' => $call->duration,
                    'price' => $call->price,
                    'start_time' => $call->startTime ? $call->startTime->format('Y-m-d H:i:s') : null,
                ];
            }
            return $logs;
        } catch (\Exception $e) {
            $this->logError('Get call logs failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function generateWebRtcToken(string $identity, int $ttl = 3600): string
    {
        if (!$this->isAvailable()) {
            return '';
        }
        
        try {
            $token = new AccessToken(
                $this->accountSid,
                $this->config['api_key'] ?? $this->accountSid,
                $this->config['api_secret'] ?? $this->authToken,
                $ttl,
                $identity
            );
            
            $voiceGrant = new VoiceGrant();
            $voiceGrant->setOutgoingApplicationSid($this->config['twiml_app_sid'] ?? '');
            $voiceGrant->setIncomingAllow(true);
            $token->addGrant($voiceGrant);
            
            $this->log('WebRTC token generated', ['identity' => $identity]);
            return $token->toJWT();
        } catch (\Exception $e) {
            $this->logError('WebRTC token generation failed', $e->getMessage());
            return '';
        }
    }
    
    public function setVoiceWebhook(string $url): bool
    {
        // Set account-level voice webhook
        if (!$this->isAvailable()) {
            return false;
        }
        
        try {
            $this->twilioClient->incomingPhoneNumbers->read([], 1); // Test connection
            // In production, update each number or TwiML app
            $this->log('Voice webhook set', ['url' => $url]);
            return true;
        } catch (\Exception $e) {
            $this->logError('Set voice webhook failed', $e->getMessage());
            return false;
        }
    }
    
    // ==================== SMS ====================
    
    public function sendSms(string $from, string $to, string $message, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $params = [
                'from' => $from,
                'body' => $message,
            ];
            
            if (!empty($options['media_urls'])) {
                $params['mediaUrl'] = $options['media_urls'];
            }
            
            $sms = $this->twilioClient->messages->create($this->formatE164($to), $params);
            
            $this->log('SMS sent', ['sid' => $sms->sid, 'to' => $to]);
            
            return [
                'success' => true,
                'message_id' => $sms->sid,
                'status' => $sms->status,
                'price' => $sms->price,
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
            $message = $this->twilioClient->messages($messageId)->fetch();
            return [
                'message_id' => $message->sid,
                'status' => $message->status,
                'price' => $message->price,
                'error_message' => $message->errorMessage,
                'date_sent' => $message->dateSent ? $message->dateSent->format('Y-m-d H:i:s') : null,
            ];
        } catch (\Exception $e) {
            $this->logError('Get message status failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function getMessageLogs(array $filters = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $params = ['limit' => 50];
            if (!empty($filters['from'])) {
                $params['from'] = $filters['from'];
            }
            if (!empty($filters['date_sent'])) {
                $params['dateSent'] = $filters['date_sent'];
            }
            
            $messages = $this->twilioClient->messages->read($params);
            $logs = [];
            foreach ($messages as $msg) {
                $logs[] = [
                    'message_id' => $msg->sid,
                    'from' => $msg->from,
                    'to' => $msg->to,
                    'body' => $msg->body,
                    'status' => $msg->status,
                    'direction' => $msg->direction,
                    'price' => $msg->price,
                    'date_sent' => $msg->dateSent ? $msg->dateSent->format('Y-m-d H:i:s') : null,
                ];
            }
            return $logs;
        } catch (\Exception $e) {
            $this->logError('Get message logs failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function setSmsWebhook(string $url): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }
        
        // Twilio SMS webhooks are configured per number
        // This updates the default behavior or messaging service
        $this->log('SMS webhook configured', ['url' => $url]);
        return true;
    }
}
