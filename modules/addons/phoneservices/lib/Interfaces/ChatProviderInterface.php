<?php
/**
 * Chat / OTT messaging provider contract (WhatsApp Business and equivalents).
 *
 * @package PhoneServices
 */

namespace PhoneServices\Interfaces;

interface ChatProviderInterface extends TelecomProviderInterface
{
    /**
     * Send a free-form session message.
     *
     * @return array{success:bool,error:?string,message_id?:string,status?:string}
     */
    public function sendChatMessage(string $to, string $message, array $options = []): array;

    /**
     * Send an approved template message (required outside the 24h window).
     *
     * @param array<int,string|array> $parameters
     */
    public function sendTemplate(string $to, string $templateName, string $language, array $parameters = [], array $options = []): array;

    /**
     * Delivery status of a previously sent message.
     */
    public function getChatMessageStatus(string $messageId): array;

    /**
     * Verify an inbound webhook request (signature / verify token).
     *
     * @param array<string,mixed> $headers
     */
    public function verifyWebhook(string $rawBody, array $headers): bool;

    /**
     * Normalise an inbound webhook payload into platform message records.
     *
     * @return array<int,array<string,mixed>>
     */
    public function parseInboundWebhook(array $payload): array;
}
