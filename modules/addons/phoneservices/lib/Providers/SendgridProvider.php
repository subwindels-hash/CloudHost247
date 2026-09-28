<?php
/**
 * SendGrid provider - transactional email (v3 Mail Send API).
 *
 * Used by the messaging service for email-delivered OTPs, number/eSIM
 * lifecycle notifications and usage alerts.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

use PhoneServices\Core\Database;
use PhoneServices\Interfaces\EmailProviderInterface;

class SendgridProvider extends AbstractProvider implements EmailProviderInterface
{
    const BASE_URL = 'https://api.sendgrid.com/v3';

    public function getName(): string
    {
        return 'sendgrid';
    }

    public function getCapabilities(): array
    {
        return ['email'];
    }

    public function isAvailable(): bool
    {
        return $this->cfg('api_key') !== '';
    }

    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            $this->lastError = 'SendGrid API key is not configured';
            return false;
        }

        $response = $this->get(self::BASE_URL . '/scopes', [], $this->headers());

        return (int) $response['status'] === 200;
    }

    /**
     * @param array<string,mixed> $options
     * @return array<string,mixed>
     */
    public function sendEmail(string $to, string $subject, string $htmlBody, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('SendGrid provider is not configured');
        }

        $fromEmail = (string) ($options['from'] ?? $this->cfg('from_email'));
        if ($fromEmail === '' || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
            return $this->failure('A valid sender address is required (set the SendGrid "from_email" credential)');
        }

        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return $this->failure('Invalid recipient email address');
        }

        $payload = [
            'personalizations' => [[
                'to'      => [['email' => $to]],
                'subject' => $subject,
            ]],
            'from' => [
                'email' => $fromEmail,
                'name'  => (string) ($options['from_name'] ?? $this->cfg('from_name', 'Phone Services')),
            ],
            'content' => [],
        ];

        if (!empty($options['text'])) {
            $payload['content'][] = ['type' => 'text/plain', 'value' => (string) $options['text']];
        }

        if ($htmlBody !== '') {
            $payload['content'][] = ['type' => 'text/html', 'value' => $htmlBody];
        }

        if (!$payload['content']) {
            return $this->failure('Email body cannot be empty');
        }

        if (!empty($options['reply_to']) && filter_var($options['reply_to'], FILTER_VALIDATE_EMAIL)) {
            $payload['reply_to'] = ['email' => (string) $options['reply_to']];
        }

        if (!empty($options['categories']) && is_array($options['categories'])) {
            $payload['categories'] = array_slice(array_values($options['categories']), 0, 10);
        }

        // Dynamic template support (SendGrid handles the rendering).
        if (!empty($options['template_id'])) {
            $payload['template_id'] = (string) $options['template_id'];
            unset($payload['content']);
            $payload['personalizations'][0]['dynamic_template_data'] = (array) ($options['dynamic_data'] ?? []);
            unset($payload['personalizations'][0]['subject']);
        }

        $response = $this->post(self::BASE_URL . '/mail/send', $payload, $this->headers());
        $status = (int) ($response['status'] ?? 0);

        if ($status !== 202) {
            return $this->failure((string) ($response['error'] ?? 'SendGrid rejected the message'), [
                'provider_status' => $status,
            ]);
        }

        // SendGrid returns the id in the X-Message-Id header; the raw body is
        // empty on success, so we synthesise a correlation id for our logs.
        $messageId = 'sg_' . bin2hex(random_bytes(8));

        return $this->success([
            'message_id' => $messageId,
            'status'     => 'accepted',
            'provider'   => $this->getName(),
        ]);
    }

    /**
     * Status is delivered asynchronously through SendGrid Event Webhooks; we
     * return the latest event recorded for the message.
     */
    public function getEmailStatus(string $messageId): array
    {
        $event = Database::row(
            'mod_phoneservices_provider_events',
            '*',
            ['provider' => 'sendgrid', 'external_id' => $messageId],
            'id',
            'DESC'
        );

        if (!$event) {
            return $this->success(['message_id' => $messageId, 'status' => 'unknown']);
        }

        $payload = json_decode((string) $event['payload'], true) ?: [];

        return $this->success([
            'message_id' => $messageId,
            'status'     => $payload['event'] ?? 'unknown',
            'updated_at' => $event['created_at'] ?? null,
        ]);
    }

    /**
     * @return array<string,string>
     */
    private function headers(): array
    {
        return ['Authorization' => 'Bearer ' . $this->cfg('api_key')];
    }
}
