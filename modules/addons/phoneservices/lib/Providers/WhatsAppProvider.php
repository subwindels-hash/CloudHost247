<?php
/**
 * WhatsApp Business provider (Meta Cloud API v20.0).
 *
 * Implements the platform chat contract: session messages, approved template
 * messages (used for OTP delivery outside the 24h window), delivery status and
 * signed inbound webhooks.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

use PhoneServices\Core\Crypto;
use PhoneServices\Interfaces\ChatProviderInterface;

class WhatsAppProvider extends AbstractProvider implements ChatProviderInterface
{
    const API_VERSION = 'v20.0';
    const BASE_URL = 'https://graph.facebook.com';

    public function getName(): string
    {
        return 'whatsapp';
    }

    public function getCapabilities(): array
    {
        return ['whatsapp'];
    }

    public function isAvailable(): bool
    {
        return $this->cfg('access_token') !== '' && $this->cfg('phone_number_id') !== '';
    }

    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            $this->lastError = 'WhatsApp credentials are incomplete';
            return false;
        }

        $response = $this->get($this->endpoint(''), ['fields' => 'display_phone_number,verified_name'], $this->headers());

        return (int) $response['status'] === 200;
    }

    /**
     * Send a free-form (session) message.
     */
    public function sendChatMessage(string $to, string $message, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('WhatsApp provider is not configured');
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'recipient_type'    => 'individual',
            'to'                => ltrim($this->formatE164($to, $options['country'] ?? 'US'), '+'),
            'type'              => 'text',
            'text'              => [
                'preview_url' => (bool) ($options['preview_url'] ?? false),
                'body'        => $message,
            ],
        ];

        $response = $this->post($this->endpoint('/messages'), $payload, $this->headers());

        return $this->normaliseSendResponse($response);
    }

    /**
     * Send an approved template message (OTP, alerts, notifications).
     */
    public function sendTemplate(string $to, string $templateName, string $language, array $parameters = [], array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('WhatsApp provider is not configured');
        }

        $components = [];

        if ($parameters) {
            $components[] = [
                'type'       => 'body',
                'parameters' => array_map(static function ($parameter) {
                    return is_array($parameter) ? $parameter : ['type' => 'text', 'text' => (string) $parameter];
                }, $parameters),
            ];
        }

        // OTP templates require the code to be echoed in the button component.
        if (!empty($options['otp_code'])) {
            $components[] = [
                'type'     => 'button',
                'sub_type' => 'url',
                'index'    => '0',
                'parameters' => [['type' => 'text', 'text' => (string) $options['otp_code']]],
            ];
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'to'                => ltrim($this->formatE164($to, $options['country'] ?? 'US'), '+'),
            'type'              => 'template',
            'template'          => [
                'name'     => $templateName,
                'language' => ['code' => $language ?: 'en_US'],
            ],
        ];

        if ($components) {
            $payload['template']['components'] = $components;
        }

        $response = $this->post($this->endpoint('/messages'), $payload, $this->headers());

        return $this->normaliseSendResponse($response);
    }

    /**
     * The Cloud API pushes statuses over webhooks rather than exposing a
     * per-message read endpoint, so we serve the last known status recorded by
     * the webhook handler.
     */
    public function getChatMessageStatus(string $messageId): array
    {
        $event = \PhoneServices\Core\Database::row(
            'mod_phoneservices_provider_events',
            '*',
            ['provider' => 'whatsapp', 'external_id' => $messageId],
            'id',
            'DESC'
        );

        if (!$event) {
            return $this->success(['status' => 'unknown', 'message_id' => $messageId]);
        }

        $payload = json_decode((string) $event['payload'], true) ?: [];

        return $this->success([
            'message_id' => $messageId,
            'status'     => $payload['status'] ?? 'unknown',
            'updated_at' => $event['created_at'] ?? null,
        ]);
    }

    /**
     * Validate X-Hub-Signature-256 (HMAC SHA-256 of the raw body with the app
     * secret). Falls back to the verify token when no app secret is stored.
     *
     * @param array<string,mixed> $headers
     */
    public function verifyWebhook(string $rawBody, array $headers): bool
    {
        $appSecret = (string) $this->cfg('app_secret');
        $headers = array_change_key_case($headers, CASE_LOWER);
        $signature = (string) ($headers['x-hub-signature-256'] ?? $headers['http_x_hub_signature_256'] ?? '');

        if ($appSecret !== '' && $signature !== '') {
            $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $appSecret);
            if (!Crypto::secureCompare($expected, $signature)) {
                $this->logError('Webhook verification', 'Signature mismatch');
                return false;
            }

            return true;
        }

        $verifyToken = (string) $this->cfg('verify_token');
        if ($verifyToken !== '') {
            $provided = (string) ($headers['x-verify-token'] ?? '');
            return Crypto::secureCompare($verifyToken, $provided);
        }

        $this->logError('Webhook verification', 'No app secret or verify token configured');

        return false;
    }

    /**
     * Flatten a Cloud API webhook into inbound messages and status updates.
     *
     * @return array<int,array<string,mixed>>
     */
    public function parseInboundWebhook(array $payload): array
    {
        $records = [];

        foreach ($payload['entry'] ?? [] as $entry) {
            foreach ($entry['changes'] ?? [] as $change) {
                $value = $change['value'] ?? [];

                foreach ($value['messages'] ?? [] as $message) {
                    $records[] = [
                        'kind'       => 'inbound',
                        'message_id' => $message['id'] ?? '',
                        'from'       => '+' . ltrim((string) ($message['from'] ?? ''), '+'),
                        'to'         => '+' . ltrim((string) ($value['metadata']['display_phone_number'] ?? ''), '+'),
                        'body'       => $message['text']['body'] ?? ($message['button']['text'] ?? ''),
                        'type'       => $message['type'] ?? 'text',
                        'timestamp'  => isset($message['timestamp']) ? date('Y-m-d H:i:s', (int) $message['timestamp']) : date('Y-m-d H:i:s'),
                    ];
                }

                foreach ($value['statuses'] ?? [] as $status) {
                    $records[] = [
                        'kind'       => 'status',
                        'message_id' => $status['id'] ?? '',
                        'status'     => $status['status'] ?? 'unknown',
                        'recipient'  => '+' . ltrim((string) ($status['recipient_id'] ?? ''), '+'),
                        'timestamp'  => isset($status['timestamp']) ? date('Y-m-d H:i:s', (int) $status['timestamp']) : date('Y-m-d H:i:s'),
                        'error'      => $status['errors'][0]['title'] ?? null,
                    ];
                }
            }
        }

        return $records;
    }

    /**
     * Meta's webhook subscription handshake (hub.challenge echo).
     */
    public function handleSubscriptionChallenge(array $query): ?string
    {
        $verifyToken = (string) $this->cfg('verify_token');

        if (($query['hub_mode'] ?? ($query['hub.mode'] ?? '')) !== 'subscribe') {
            return null;
        }

        $given = (string) ($query['hub_verify_token'] ?? ($query['hub.verify_token'] ?? ''));

        if ($verifyToken !== '' && Crypto::secureCompare($verifyToken, $given)) {
            return (string) ($query['hub_challenge'] ?? ($query['hub.challenge'] ?? ''));
        }

        return null;
    }

    /* ------------------------------------------------------------------ */

    /**
     * @param array<string,mixed> $response
     * @return array<string,mixed>
     */
    private function normaliseSendResponse(array $response): array
    {
        $status = (int) ($response['status'] ?? 0);
        $body = $response['body'] ?? [];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'WhatsApp send failed'), [
                'provider_status' => $status,
            ]);
        }

        return $this->success([
            'message_id' => $body['messages'][0]['id'] ?? '',
            'status'     => $body['messages'][0]['message_status'] ?? 'accepted',
            'to'         => $body['contacts'][0]['wa_id'] ?? '',
            'provider'   => $this->getName(),
        ]);
    }

    private function endpoint(string $path): string
    {
        return self::BASE_URL . '/' . self::API_VERSION . '/' . trim((string) $this->cfg('phone_number_id'), '/') . $path;
    }

    /**
     * @return array<string,string>
     */
    private function headers(): array
    {
        return ['Authorization' => 'Bearer ' . $this->cfg('access_token')];
    }
}
