<?php
/**
 * SMS Provider Interface
 */

namespace PhoneServices\Interfaces;

interface SmsProviderInterface extends TelecomProviderInterface
{
    /**
     * Send SMS message
     */
    public function sendSms(string $from, string $to, string $message, array $options = []): array;
    
    /**
     * Send bulk SMS
     */
    public function sendBulkSms(string $from, array $recipients, string $message): array;
    
    /**
     * Get message status
     */
    public function getMessageStatus(string $messageId): array;
    
    /**
     * Get message logs
     */
    public function getMessageLogs(array $filters = []): array;
    
    /**
     * Set inbound SMS webhook
     */
    public function setSmsWebhook(string $url): bool;
}
