<?php
/**
 * SMS Service
 * Handles SMS, OTP/2FA, WhatsApp Business, and Email
 */

namespace PhoneServices\Services;

use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Config;
use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Interfaces\SmsProviderInterface;
use SendGrid\Mail\Mail as SendGridMail;
use SendGrid;

class SmsService
{
    private $provider;
    private $otpStore = [];
    
    public function __construct(string $providerName = null)
    {
        $this->provider = ProviderFactory::getProviderForService('sms', $providerName);
    }
    
    /**
     * Send SMS message
     */
    public function sendSms(int $userId, string $from, string $to, string $message, array $options = []): array
    {
        if (!$this->provider || !($this->provider instanceof SmsProviderInterface)) {
            return ['error' => 'SMS provider not available'];
        }
        
        $result = $this->provider->sendSms($from, $to, $message, $options);
        
        $record = [
            'user_id' => $userId,
            'provider' => $this->provider->getName(),
            'message_id' => $result['message_id'] ?? '',
            'from_number' => $from,
            'to_number' => $to,
            'body' => $message,
            'direction' => 'outbound',
            'status' => isset($result['error']) ? 'failed' : ($result['status'] ?? 'sent'),
            'price' => $result['price'] ?? 0,
            'segments' => $options['segments'] ?? 1,
            'created_at' => date('Y-m-d H:i:s'),
        ];
        
        $id = Database::insert('mod_phoneservices_messages', $record);
        
        Logger::info('SMS sent', ['id' => $id, 'user' => $userId, 'to' => $to]);
        
        return array_merge($result, ['id' => $id]);
    }
    
    /**
     * Send bulk SMS
     */
    public function sendBulkSms(int $userId, string $from, array $recipients, string $message): array
    {
        if (!$this->provider || !($this->provider instanceof SmsProviderInterface)) {
            return ['error' => 'SMS provider not available'];
        }
        
        $results = $this->provider->sendBulkSms($from, $recipients, $message);
        
        foreach ($results as $to => $result) {
            Database::insert('mod_phoneservices_messages', [
                'user_id' => $userId,
                'provider' => $this->provider->getName(),
                'message_id' => $result['message_id'] ?? '',
                'from_number' => $from,
                'to_number' => $to,
                'body' => $message,
                'direction' => 'outbound',
                'status' => isset($result['error']) ? 'failed' : 'sent',
                'price' => $result['price'] ?? 0,
                'created_at' => date('Y-m-d H:i:s'),
            ]);
        }
        
        Logger::info('Bulk SMS sent', ['user' => $userId, 'count' => count($recipients)]);
        return $results;
    }
    
    /**
     * Send OTP / 2FA code
     */
    public function sendOtp(int $userId, string $to, string $type = 'sms', int $length = 6, int $ttl = 300): array
    {
        $code = $this->generateOtp($length);
        $hash = password_hash($code, PASSWORD_DEFAULT);
        
        // Store OTP
        Database::insert('mod_phoneservices_otp', [
            'user_id' => $userId,
            'recipient' => $to,
            'code_hash' => $hash,
            'type' => $type,
            'expires_at' => date('Y-m-d H:i:s', time() + $ttl),
            'used' => 0,
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        
        $message = "Your verification code is: {$code}. Valid for " . ($ttl / 60) . " minutes. Do not share this code.";
        
        if ($type === 'sms') {
            $fromNumber = Config::get('default_sms_number', '');
            $result = $this->sendSms($userId, $fromNumber, $to, $message);
        } elseif ($type === 'whatsapp') {
            $result = $this->sendWhatsapp($userId, $to, $message);
        } else {
            $result = ['error' => 'Invalid OTP type'];
        }
        
        Logger::info('OTP sent', ['user' => $userId, 'type' => $type]);
        return array_merge($result, ['expires_in' => $ttl]);
    }
    
    /**
     * Verify OTP
     */
    public function verifyOtp(int $userId, string $to, string $code): bool
    {
        $result = Database::select('mod_phoneservices_otp', '*', [
            'user_id' => $userId,
            'recipient' => $to,
            'used' => 0,
        ], 'id', 'DESC', 1);
        
        if (!$result) {
            return false;
        }
        
        $otp = $result[0];
        
        if (strtotime($otp['expires_at']) < time()) {
            return false;
        }
        
        if (!password_verify($code, $otp['code_hash'])) {
            return false;
        }
        
        Database::update('mod_phoneservices_otp', ['used' => 1, 'verified_at' => date('Y-m-d H:i:s')], ['id' => $otp['id']]);
        
        Logger::info('OTP verified', ['user' => $userId]);
        return true;
    }
    
    /**
     * Send WhatsApp Business message
     */
    public function sendWhatsapp(int $userId, string $to, string $message, array $options = []): array
    {
        $token = Config::getWhatsappCredentials()['token'] ?? '';
        if (empty($token)) {
            return ['error' => 'WhatsApp Business not configured'];
        }
        
        $phoneId = Config::get('whatsapp_phone_id', '');
        if (empty($phoneId)) {
            return ['error' => 'WhatsApp Phone ID not configured'];
        }
        
        try {
            $client = new \GuzzleHttp\Client();
            $url = "https://graph.facebook.com/v18.0/{$phoneId}/messages";
            
            $payload = [
                'messaging_product' => 'whatsapp',
                'recipient_type' => 'individual',
                'to' => $to,
                'type' => 'text',
                'text' => ['body' => $message],
            ];
            
            $response = $client->post($url, [
                'headers' => [
                    'Authorization' => 'Bearer ' . $token,
                    'Content-Type' => 'application/json',
                ],
                'json' => $payload,
            ]);
            
            $data = json_decode($response->getBody()->getContents(), true);
            
            $record = [
                'user_id' => $userId,
                'provider' => 'whatsapp',
                'message_id' => $data['messages'][0]['id'] ?? '',
                'to_number' => $to,
                'body' => $message,
                'direction' => 'outbound',
                'status' => 'sent',
                'channel' => 'whatsapp',
                'created_at' => date('Y-m-d H:i:s'),
            ];
            
            $id = Database::insert('mod_phoneservices_messages', $record);
            
            Logger::info('WhatsApp sent', ['id' => $id, 'to' => $to]);
            return ['success' => true, 'message_id' => $record['message_id'], 'id' => $id];
            
        } catch (\Exception $e) {
            Logger::error('WhatsApp send failed', ['error' => $e->getMessage()]);
            return ['error' => $e->getMessage()];
        }
    }
    
    /**
     * Send email via SendGrid
     */
    public function sendEmail(int $userId, string $to, string $subject, string $body, array $options = []): array
    {
        $apiKey = Config::getSendgridCredentials()['api_key'] ?? '';
        if (empty($apiKey)) {
            return ['error' => 'SendGrid not configured'];
        }
        
        try {
            $sg = new SendGrid($apiKey);
            $mail = new SendGridMail();
            $mail->setFrom($options['from'] ?? Config::get('sendgrid_from', 'noreply@example.com'), $options['from_name'] ?? 'Phone Services');
            $mail->addTo($to);
            $mail->setSubject($subject);
            $mail->addContent('text/plain', strip_tags($body));
            $mail->addContent('text/html', $body);
            
            if (!empty($options['attachments'])) {
                foreach ($options['attachments'] as $attachment) {
                    $mail->addAttachment($attachment['content'], $attachment['type'], $attachment['name']);
                }
            }
            
            $response = $sg->send($mail);
            
            $success = $response->statusCode() >= 200 && $response->statusCode() < 300;
            
            Database::insert('mod_phoneservices_messages', [
                'user_id' => $userId,
                'provider' => 'sendgrid',
                'to_number' => $to,
                'body' => $subject,
                'direction' => 'outbound',
                'status' => $success ? 'sent' : 'failed',
                'channel' => 'email',
                'created_at' => date('Y-m-d H:i:s'),
            ]);
            
            Logger::info('Email sent', ['to' => $to, 'status' => $response->statusCode()]);
            return ['success' => $success, 'status_code' => $response->statusCode()];
            
        } catch (\Exception $e) {
            Logger::error('Email send failed', ['error' => $e->getMessage()]);
            return ['error' => $e->getMessage()];
        }
    }
    
    /**
     * Get message status
     */
    public function getMessageStatus(string $messageId): array
    {
        if (!$this->provider || !($this->provider instanceof SmsProviderInterface)) {
            return ['error' => 'SMS provider not available'];
        }
        
        return $this->provider->getMessageStatus($messageId);
    }
    
    /**
     * Get user messages
     */
    public function getUserMessages(int $userId, array $filters = []): array
    {
        $where = ['user_id' => $userId];
        if (!empty($filters['channel'])) {
            $where['channel'] = $filters['channel'];
        }
        if (!empty($filters['direction'])) {
            $where['direction'] = $filters['direction'];
        }
        if (!empty($filters['status'])) {
            $where['status'] = $filters['status'];
        }
        
        return Database::select('mod_phoneservices_messages', '*', $where, 'id', 'DESC', $filters['limit'] ?? 50);
    }
    
    /**
     * Get all messages (admin)
     */
    public function getAllMessages(array $filters = []): array
    {
        $where = [];
        if (!empty($filters['user_id'])) {
            $where['user_id'] = $filters['user_id'];
        }
        if (!empty($filters['channel'])) {
            $where['channel'] = $filters['channel'];
        }
        if (!empty($filters['status'])) {
            $where['status'] = $filters['status'];
        }
        
        return Database::select('mod_phoneservices_messages', '*', $where, 'id', 'DESC', $filters['limit'] ?? 100);
    }
    
    /**
     * Receive inbound message (webhook handler)
     */
    public function receiveInboundMessage(array $data): array
    {
        $record = [
            'provider' => $data['provider'] ?? 'unknown',
            'message_id' => $data['message_id'] ?? '',
            'from_number' => $data['from'] ?? '',
            'to_number' => $data['to'] ?? '',
            'body' => $data['body'] ?? '',
            'direction' => 'inbound',
            'status' => 'received',
            'channel' => $data['channel'] ?? 'sms',
            'created_at' => date('Y-m-d H:i:s'),
        ];
        
        // Try to match to a user by number
        $user = Database::row('mod_phoneservices_numbers', 'user_id', ['number' => $data['to']]);
        if ($user) {
            $record['user_id'] = $user['user_id'];
        }
        
        $id = Database::insert('mod_phoneservices_messages', $record);
        
        Logger::info('Inbound message received', ['id' => $id, 'from' => $data['from'] ?? '']);
        return ['success' => true, 'id' => $id];
    }
    
    /**
     * Get message logs from provider
     */
    public function syncMessageLogs(int $userId = null): array
    {
        if (!$this->provider || !($this->provider instanceof SmsProviderInterface)) {
            return ['error' => 'SMS provider not available'];
        }
        
        $filters = [];
        $logs = $this->provider->getMessageLogs($filters);
        $synced = 0;
        
        if (is_array($logs) && !isset($logs['error'])) {
            foreach ($logs as $log) {
                $existing = Database::row('mod_phoneservices_messages', 'id', ['message_id' => $log['message_id']]);
                if (!$existing) {
                    Database::insert('mod_phoneservices_messages', [
                        'user_id' => $userId ?? 0,
                        'provider' => $this->provider->getName(),
                        'message_id' => $log['message_id'],
                        'from_number' => $log['from'],
                        'to_number' => $log['to'],
                        'body' => $log['body'] ?? '',
                        'direction' => $log['direction'],
                        'status' => $log['status'],
                        'price' => abs((float) ($log['price'] ?? 0)),
                        'created_at' => $log['date_sent'] ?? date('Y-m-d H:i:s'),
                    ]);
                    $synced++;
                }
            }
        }
        
        Logger::info('Message logs synced', ['synced' => $synced]);
        return ['synced' => $synced];
    }
    
    /**
     * Generate random OTP
     */
    private function generateOtp(int $length = 6): string
    {
        $min = pow(10, $length - 1);
        $max = pow(10, $length) - 1;
        return (string) random_int($min, $max);
    }
    
    /**
     * Calculate SMS cost
     */
    public function calculateSmsCost(string $to, int $segments = 1): float
    {
        $rate = 0.0075; // Base SMS rate
        
        $pricing = Database::row('mod_phoneservices_pricing', '*', [
            'service_type' => 'sms',
            'country' => substr($to, 0, 2),
        ]);
        
        if ($pricing && !empty($pricing['rate_per_unit'])) {
            $rate = (float) $pricing['rate_per_unit'];
        }
        
        return round($rate * $segments, 4);
    }
}
