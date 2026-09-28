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
use PhoneServices\Interfaces\ChatProviderInterface;
use PhoneServices\Interfaces\EmailProviderInterface;
use PhoneServices\Interfaces\SmsProviderInterface;
use PhoneServices\Core\Security;

class SmsService
{
    private $provider;
    private $otpStore = [];
    
    public function __construct(string $providerName = null)
    {
        $this->provider = ProviderFactory::forCapability('sms', $providerName);
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
        if (!Security::rateLimit('otp:' . $userId . ':' . preg_replace('/[^0-9a-z@.+]/i', '', $to), Config::getInt('otp_max_attempts', 5), 900)) {
            return ['success' => false, 'error' => 'Too many verification codes requested. Please wait before retrying.'];
        }

        $length = $length ?: Config::getInt('otp_length', 6);
        $ttl = $ttl ?: Config::getInt('otp_ttl_seconds', 300);

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
        
        switch ($type) {
            case 'sms':
                $result = $this->sendSms($userId, (string) Config::get('default_sms_number', ''), $to, $message);
                break;
            case 'whatsapp':
                $template = (string) Config::get('whatsapp_otp_template', '');
                $result = $template !== ''
                    ? $this->sendWhatsapp($userId, $to, $message, [
                        'template'   => $template,
                        'language'   => (string) Config::get('whatsapp_otp_language', 'en_US'),
                        'parameters' => [$code],
                        'otp_code'   => $code,
                    ])
                    : $this->sendWhatsapp($userId, $to, $message);
                break;
            case 'email':
                $result = $this->sendEmail(
                    $userId,
                    $to,
                    'Your verification code',
                    '<p>' . htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</p>',
                    ['categories' => ['otp']]
                );
                break;
            default:
                $result = ['success' => false, 'error' => 'Unsupported OTP channel: ' . $type];
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
        $provider = ProviderFactory::forCapability('whatsapp', $options['provider'] ?? null);

        if (!$provider instanceof ChatProviderInterface) {
            return ['success' => false, 'error' => 'No WhatsApp provider is configured'];
        }

        if (!empty($options['template'])) {
            $result = $provider->sendTemplate(
                $to,
                (string) $options['template'],
                (string) ($options['language'] ?? 'en_US'),
                (array) ($options['parameters'] ?? []),
                $options
            );
        } else {
            $result = $provider->sendChatMessage($to, $message, $options);
        }

        $id = Database::insert('mod_phoneservices_messages', [
            'user_id'    => $userId,
            'provider'   => $provider->getName(),
            'message_id' => (string) ($result['message_id'] ?? ''),
            'to_number'  => $to,
            'body'       => mb_substr($message, 0, 2000),
            'direction'  => 'outbound',
            'status'     => !empty($result['success']) ? 'sent' : 'failed',
            'channel'    => 'whatsapp',
            'error_message' => $result['error'] ?? null,
            'created_at' => date('Y-m-d H:i:s'),
        ]);

        if (empty($result['success'])) {
            Logger::error('WhatsApp send failed', ['to' => $to, 'error' => $result['error'] ?? 'unknown']);

            return ['success' => false, 'error' => $result['error'] ?? 'WhatsApp send failed', 'id' => $id];
        }

        Logger::info('WhatsApp message sent', ['id' => $id, 'user' => $userId]);

        return ['success' => true, 'id' => $id, 'message_id' => $result['message_id'] ?? '', 'provider' => $provider->getName()];
    }

    /**
     * Send a transactional email through the configured email provider
     * (SendGrid by default).
     *
     * @param array<string,mixed> $options
     * @return array<string,mixed>
     */
    public function sendEmail(int $userId, string $to, string $subject, string $body, array $options = []): array
    {
        $provider = ProviderFactory::forCapability('email', $options['provider'] ?? null);

        if (!$provider instanceof EmailProviderInterface) {
            return ['success' => false, 'error' => 'No email provider is configured'];
        }

        $options['text'] = $options['text'] ?? strip_tags($body);
        $result = $provider->sendEmail($to, $subject, $body, $options);

        $id = Database::insert('mod_phoneservices_messages', [
            'user_id'    => $userId,
            'provider'   => $provider->getName(),
            'message_id' => (string) ($result['message_id'] ?? ''),
            'to_number'  => $to,
            'body'       => mb_substr($subject, 0, 255),
            'direction'  => 'outbound',
            'status'     => !empty($result['success']) ? 'sent' : 'failed',
            'channel'    => 'email',
            'error_message' => $result['error'] ?? null,
            'created_at' => date('Y-m-d H:i:s'),
        ]);

        if (empty($result['success'])) {
            Logger::error('Email send failed', ['to' => $to, 'error' => $result['error'] ?? 'unknown']);

            return ['success' => false, 'error' => $result['error'] ?? 'Email send failed', 'id' => $id];
        }

        Logger::info('Email sent', ['id' => $id, 'user' => $userId]);

        return ['success' => true, 'id' => $id, 'message_id' => $result['message_id'] ?? ''];
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
        
        return Database::select('mod_phoneservices_messages', '*', $where, 'id', 'DESC', (int) ($filters['limit'] ?? 100));
    }

    /**
     * Aggregate messaging metrics for the admin SMS screen.
     *
     * @return array<string,mixed>
     */
    public function getMessageStatistics(array $filters = []): array
    {
        $sql = 'SELECT COUNT(*) AS total,
                       COALESCE(SUM(cost),0) AS total_cost,
                       SUM(CASE WHEN status = "delivered" THEN 1 ELSE 0 END) AS delivered,
                       SUM(CASE WHEN status = "failed" THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN direction = "inbound" THEN 1 ELSE 0 END) AS inbound,
                       SUM(CASE WHEN channel = "whatsapp" THEN 1 ELSE 0 END) AS whatsapp,
                       SUM(CASE WHEN channel = "email" THEN 1 ELSE 0 END) AS email
                  FROM mod_phoneservices_messages
                 WHERE 1 = 1';
        $bindings = [];

        if (!empty($filters['user_id'])) {
            $sql .= ' AND user_id = ?';
            $bindings[] = (int) $filters['user_id'];
        }
        if (!empty($filters['from'])) {
            $sql .= ' AND created_at >= ?';
            $bindings[] = date('Y-m-d 00:00:00', strtotime((string) $filters['from']));
        }

        $row = Database::raw($sql, $bindings)[0] ?? [];
        $total = (int) ($row['total'] ?? 0);
        $delivered = (int) ($row['delivered'] ?? 0);

        return [
            'total'         => $total,
            'delivered'     => $delivered,
            'failed'        => (int) ($row['failed'] ?? 0),
            'inbound'       => (int) ($row['inbound'] ?? 0),
            'whatsapp'      => (int) ($row['whatsapp'] ?? 0),
            'email'         => (int) ($row['email'] ?? 0),
            'total_cost'    => round((float) ($row['total_cost'] ?? 0), 4),
            'delivery_rate' => $total > 0 ? round(($delivered / $total) * 100, 1) : 0.0,
        ];
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
