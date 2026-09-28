<?php
/**
 * Vonage provider - numbers, voice and SMS.
 *
 * Uses the Vonage REST APIs directly (Messages/SMS, Voice, Numbers, Account)
 * so the module carries no SDK dependency. Implements the identical contracts
 * as the Twilio provider, which is what makes providers hot-swappable from the
 * admin panel.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

use PhoneServices\Core\Crypto;
use PhoneServices\Interfaces\NumberProviderInterface;
use PhoneServices\Interfaces\SmsProviderInterface;
use PhoneServices\Interfaces\VoiceProviderInterface;

class VonageProvider extends AbstractProvider implements NumberProviderInterface, VoiceProviderInterface, SmsProviderInterface
{
    const REST_BASE = 'https://rest.nexmo.com';
    const API_BASE = 'https://api.nexmo.com';

    public function getName(): string
    {
        return 'vonage';
    }

    public function getCapabilities(): array
    {
        return ['numbers', 'voice', 'sms'];
    }

    public function isAvailable(): bool
    {
        return (string) $this->cfg('api_key') !== '' && (string) $this->cfg('api_secret') !== '';
    }

    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            $this->lastError = 'Vonage credentials are incomplete';
            return false;
        }

        $response = $this->get(self::REST_BASE . '/account/get-balance', $this->auth(), ['Accept' => 'application/json']);

        return (int) $response['status'] === 200 && isset($response['body']['value']);
    }

    /**
     * Account balance - surfaced on the admin provider health page.
     */
    public function getBalance(): float
    {
        $response = $this->get(self::REST_BASE . '/account/get-balance', $this->auth(), ['Accept' => 'application/json']);

        return (float) ($response['body']['value'] ?? 0);
    }

    /* ==================================================================
     | Numbers
     * ================================================================= */

    /**
     * @return array<int,array<string,mixed>>
     */
    public function searchNumbers(string $country, string $type = 'local', array $filters = []): array
    {
        if (!$this->isAvailable()) {
            return [];
        }

        $query = array_merge($this->auth(), [
            'country' => strtoupper(substr($country, 0, 2)),
            'size'    => (int) ($filters['limit'] ?? 20),
            'type'    => $this->mapType($type),
        ]);

        if (!empty($filters['contains'])) {
            $query['pattern'] = preg_replace('/[^0-9]/', '', (string) $filters['contains']);
            $query['search_pattern'] = 1;
        }

        $response = $this->get(self::REST_BASE . '/number/search', $query, ['Accept' => 'application/json']);

        if ((int) $response['status'] !== 200) {
            return [];
        }

        $results = [];
        foreach ($response['body']['numbers'] ?? [] as $number) {
            $features = (array) ($number['features'] ?? []);
            $results[] = [
                'number'       => '+' . ltrim((string) ($number['msisdn'] ?? ''), '+'),
                'friendly'     => (string) ($number['msisdn'] ?? ''),
                'country'      => (string) ($number['country'] ?? strtoupper($country)),
                'type'         => $type,
                'region'       => '',
                'cost'         => (float) ($number['cost'] ?? 0),
                'capabilities' => [
                    'voice' => in_array('VOICE', $features, true),
                    'sms'   => in_array('SMS', $features, true),
                    'mms'   => in_array('MMS', $features, true),
                ],
                'provider'     => $this->getName(),
            ];
        }

        return $results;
    }

    /**
     * @return array<string,mixed>
     */
    public function purchaseNumber(string $number, string $country, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Vonage provider is not configured');
        }

        $msisdn = ltrim($this->formatE164($number, $country), '+');

        $response = $this->postForm(self::REST_BASE . '/number/buy', array_merge($this->auth(), [
            'country' => strtoupper($country),
            'msisdn'  => $msisdn,
        ]), ['Accept' => 'application/json']);

        $body = $response['body'] ?? [];

        if ((int) $response['status'] !== 200 || (string) ($body['error-code'] ?? '200') !== '200') {
            return $this->failure((string) ($body['error-code-label'] ?? ($response['error'] ?? 'Number purchase failed')));
        }

        // Point the number at our webhooks straight away.
        $this->updateNumberConfig($msisdn, [
            'country'   => strtoupper($country),
            'sms_url'   => $options['sms_url'] ?? $this->webhookUrl('sms'),
            'voice_url' => $options['voice_url'] ?? $this->webhookUrl('voice'),
        ]);

        return $this->success([
            'provider_reference' => $msisdn,
            'number'             => '+' . $msisdn,
            'country'            => strtoupper($country),
            'provider'           => $this->getName(),
        ]);
    }

    public function releaseNumber(string $numberId): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }

        $msisdn = ltrim($numberId, '+');
        $country = $this->countryForNumber($msisdn);

        $response = $this->postForm(self::REST_BASE . '/number/cancel', array_merge($this->auth(), [
            'country' => $country,
            'msisdn'  => $msisdn,
        ]), ['Accept' => 'application/json']);

        $body = $response['body'] ?? [];

        return (int) $response['status'] === 200 && (string) ($body['error-code'] ?? '200') === '200';
    }

    /**
     * Vonage numbers auto-renew monthly; we verify ownership and report the
     * next renewal date.
     *
     * @return array<string,mixed>
     */
    public function renewNumber(string $numberId, int $months = 1): array
    {
        $details = $this->getNumberDetails($numberId);

        if (empty($details['success'])) {
            return $this->failure((string) ($details['error'] ?? 'Number not found upstream'));
        }

        return $this->success([
            'provider_reference' => $numberId,
            'renewed_until'      => date('Y-m-d H:i:s', strtotime('+' . max(1, $months) . ' month')),
            'auto_renew'         => true,
        ]);
    }

    /**
     * @return array<string,mixed>
     */
    public function getNumberDetails(string $numberId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Vonage provider is not configured');
        }

        $msisdn = ltrim($numberId, '+');

        $response = $this->get(self::REST_BASE . '/account/numbers', array_merge($this->auth(), [
            'pattern'        => $msisdn,
            'search_pattern' => 1,
        ]), ['Accept' => 'application/json']);

        $number = $response['body']['numbers'][0] ?? null;

        if (!$number) {
            return $this->failure('Number not found on the Vonage account');
        }

        return $this->success([
            'provider_reference' => $msisdn,
            'number'             => '+' . $msisdn,
            'country'            => (string) ($number['country'] ?? ''),
            'capabilities'       => (array) ($number['features'] ?? []),
            'voice_url'          => (string) ($number['voiceCallbackValue'] ?? ''),
            'sms_url'            => (string) ($number['moHttpUrl'] ?? ''),
            'status'             => 'in-use',
        ]);
    }

    /**
     * @param array<string,mixed> $config
     */
    public function updateNumberConfig(string $numberId, array $config): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }

        $msisdn = ltrim($numberId, '+');

        $payload = array_merge($this->auth(), [
            'country' => strtoupper((string) ($config['country'] ?? $this->countryForNumber($msisdn))),
            'msisdn'  => $msisdn,
        ]);

        if (!empty($config['sms_url'])) {
            $payload['moHttpUrl'] = (string) $config['sms_url'];
        }
        if (!empty($config['voice_url'])) {
            $payload['voiceCallbackType'] = 'app';
            $payload['voiceCallbackValue'] = (string) ($this->cfg('application_id') ?: $config['voice_url']);
        }
        if (!empty($config['status_callback'])) {
            $payload['voiceStatusCallback'] = (string) $config['status_callback'];
        }

        $response = $this->postForm(self::REST_BASE . '/number/update', $payload, ['Accept' => 'application/json']);

        return (int) $response['status'] === 200;
    }

    /* ==================================================================
     | Voice
     * ================================================================= */

    /**
     * Outbound calls use the Voice API, which requires a JWT signed with the
     * application private key.
     *
     * @return array<string,mixed>
     */
    public function initiateCall(string $from, string $to, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Vonage provider is not configured');
        }

        $jwt = $this->applicationJwt();

        if ($jwt === '') {
            return $this->failure('Vonage Voice requires an application ID and private key');
        }

        $payload = [
            'to'   => [['type' => 'phone', 'number' => ltrim($this->formatE164($to, $options['to_country'] ?? 'US'), '+')]],
            'from' => ['type' => 'phone', 'number' => ltrim($this->formatE164($from, $options['from_country'] ?? 'US'), '+')],
            'event_url' => [(string) ($options['status_callback'] ?? $this->webhookUrl('call-status'))],
        ];

        if (!empty($options['ncco'])) {
            $payload['ncco'] = $options['ncco'];
        } else {
            $payload['answer_url'] = [(string) ($options['url'] ?? $this->webhookUrl('voice'))];
        }

        $response = $this->post(self::API_BASE . '/v1/calls', $payload, [
            'Authorization' => 'Bearer ' . $jwt,
            'Accept'        => 'application/json',
        ]);

        $status = (int) $response['status'];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'Call could not be placed'), ['provider_status' => $status]);
        }

        $body = $response['body'] ?? [];

        return $this->success([
            'call_id'   => (string) ($body['uuid'] ?? ''),
            'status'    => self::mapCallStatus((string) ($body['status'] ?? 'started')),
            'from'      => $from,
            'to'        => $to,
            'direction' => (string) ($body['direction'] ?? 'outbound'),
            'provider'  => $this->getName(),
        ]);
    }

    public function endCall(string $callId): bool
    {
        $jwt = $this->applicationJwt();

        if ($jwt === '' || $callId === '') {
            return false;
        }

        $response = $this->put(self::API_BASE . '/v1/calls/' . rawurlencode($callId), ['action' => 'hangup'], [
            'Authorization' => 'Bearer ' . $jwt,
        ]);

        return (int) $response['status'] === 204 || (int) $response['status'] === 200;
    }

    /**
     * @return array<string,mixed>
     */
    public function getCallDetails(string $callId): array
    {
        $jwt = $this->applicationJwt();

        if ($jwt === '') {
            return $this->failure('Vonage Voice requires an application ID and private key');
        }

        $response = $this->get(self::API_BASE . '/v1/calls/' . rawurlencode($callId), [], [
            'Authorization' => 'Bearer ' . $jwt,
        ]);

        if ((int) $response['status'] !== 200) {
            return $this->failure((string) ($response['error'] ?? 'Call lookup failed'));
        }

        $body = $response['body'] ?? [];

        return $this->success([
            'call_id'    => (string) ($body['uuid'] ?? $callId),
            'status'     => self::mapCallStatus((string) ($body['status'] ?? '')),
            'from'       => (string) ($body['from']['number'] ?? ''),
            'to'         => (string) ($body['to']['number'] ?? ''),
            'duration'   => (int) ($body['duration'] ?? 0),
            'cost'       => (float) ($body['price'] ?? 0),
            'currency'   => 'EUR',
            'direction'  => (string) ($body['direction'] ?? ''),
            'started_at' => !empty($body['start_time']) ? date('Y-m-d H:i:s', strtotime((string) $body['start_time'])) : null,
            'ended_at'   => !empty($body['end_time']) ? date('Y-m-d H:i:s', strtotime((string) $body['end_time'])) : null,
        ]);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getCallLogs(array $filters = []): array
    {
        $jwt = $this->applicationJwt();

        if ($jwt === '') {
            return [];
        }

        $query = ['page_size' => (int) ($filters['limit'] ?? 50)];

        if (!empty($filters['status'])) {
            $query['status'] = (string) $filters['status'];
        }
        if (!empty($filters['start_date'])) {
            $query['date_start'] = gmdate('Y-m-d\TH:i:s\Z', strtotime((string) $filters['start_date']));
        }

        $response = $this->get(self::API_BASE . '/v1/calls', $query, ['Authorization' => 'Bearer ' . $jwt]);

        if ((int) $response['status'] !== 200) {
            return [];
        }

        $logs = [];
        foreach ($response['body']['_embedded']['calls'] ?? [] as $call) {
            $logs[] = [
                'call_id'    => (string) ($call['uuid'] ?? ''),
                'from'       => (string) ($call['from']['number'] ?? ''),
                'to'         => (string) ($call['to']['number'] ?? ''),
                'status'     => self::mapCallStatus((string) ($call['status'] ?? '')),
                'duration'   => (int) ($call['duration'] ?? 0),
                'cost'       => (float) ($call['price'] ?? 0),
                'currency'   => 'EUR',
                'direction'  => (string) ($call['direction'] ?? ''),
                'started_at' => !empty($call['start_time']) ? date('Y-m-d H:i:s', strtotime((string) $call['start_time'])) : null,
                'ended_at'   => !empty($call['end_time']) ? date('Y-m-d H:i:s', strtotime((string) $call['end_time'])) : null,
            ];
        }

        return $logs;
    }

    /**
     * Vonage browser calling uses a JWT with a `sub` (user) claim.
     */
    public function generateWebRtcToken(string $identity, int $ttl = 3600): string
    {
        $identity = preg_replace('/[^A-Za-z0-9_.@-]/', '', $identity);

        return $this->applicationJwt($ttl, [
            'sub' => $identity,
            'acl' => [
                'paths' => [
                    '/*/users/**'        => new \stdClass(),
                    '/*/conversations/**' => new \stdClass(),
                    '/*/sessions/**'     => new \stdClass(),
                    '/*/devices/**'      => new \stdClass(),
                    '/*/rtc/**'          => new \stdClass(),
                ],
            ],
        ]);
    }

    public function setVoiceWebhook(string $url): bool
    {
        // Voice routing is configured on the Vonage application, not per
        // number; we persist it so number provisioning reuses the value.
        \PhoneServices\Core\Config::set('vonage_voice_webhook', $url);

        return true;
    }

    /* ==================================================================
     | SMS
     * ================================================================= */

    /**
     * @return array<string,mixed>
     */
    public function sendSms(string $from, string $to, string $message, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Vonage provider is not configured');
        }

        if (trim($message) === '') {
            return $this->failure('Message body cannot be empty');
        }

        $payload = array_merge($this->auth(), [
            'from'                => ltrim($this->formatE164($from, $options['country'] ?? 'US'), '+'),
            'to'                  => ltrim($this->formatE164($to, $options['country'] ?? 'US'), '+'),
            'text'                => $message,
            'type'                => preg_match('/[^\x20-\x7E]/', $message) ? 'unicode' : 'text',
            'status-report-req'   => 1,
            'callback'            => (string) ($options['status_callback'] ?? $this->webhookUrl('sms-status')),
        ]);

        $response = $this->postForm(self::REST_BASE . '/sms/json', $payload, ['Accept' => 'application/json']);
        $entry = $response['body']['messages'][0] ?? [];
        $statusCode = (string) ($entry['status'] ?? '1');

        if ((int) $response['status'] !== 200 || $statusCode !== '0') {
            return $this->failure((string) ($entry['error-text'] ?? ($response['error'] ?? 'SMS send failed')), [
                'provider_status' => $statusCode,
            ]);
        }

        return $this->success([
            'message_id' => (string) ($entry['message-id'] ?? ''),
            'status'     => 'sent',
            'cost'       => (float) ($entry['message-price'] ?? 0),
            'segments'   => (int) ($response['body']['message-count'] ?? 1),
            'to'         => (string) ($entry['to'] ?? $to),
            'provider'   => $this->getName(),
        ]);
    }

    /**
     * @param string[] $recipients
     * @return array<string,mixed>
     */
    public function sendBulkSms(string $from, array $recipients, string $message): array
    {
        $sent = [];
        $failed = [];

        foreach ($recipients as $recipient) {
            $result = $this->sendSms($from, (string) $recipient, $message);
            if (!empty($result['success'])) {
                $sent[] = ['to' => $recipient, 'message_id' => $result['message_id'] ?? ''];
            } else {
                $failed[] = ['to' => $recipient, 'error' => $result['error'] ?? 'unknown'];
            }
        }

        return $this->success([
            'sent_count'   => count($sent),
            'failed_count' => count($failed),
            'sent'         => $sent,
            'failed'       => $failed,
        ]);
    }

    /**
     * Vonage reports SMS status over webhooks; we return the last recorded
     * delivery receipt.
     *
     * @return array<string,mixed>
     */
    public function getMessageStatus(string $messageId): array
    {
        $event = \PhoneServices\Core\Database::row(
            'mod_phoneservices_provider_events',
            '*',
            ['provider' => 'vonage', 'external_id' => $messageId],
            'id',
            'DESC'
        );

        if (!$event) {
            return $this->success(['message_id' => $messageId, 'status' => 'unknown']);
        }

        $payload = json_decode((string) $event['payload'], true) ?: [];

        return $this->success([
            'message_id' => $messageId,
            'status'     => self::mapMessageStatus((string) ($payload['status'] ?? '')),
            'updated_at' => $event['created_at'] ?? null,
        ]);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getMessageLogs(array $filters = []): array
    {
        $rows = \PhoneServices\Core\Database::select(
            'mod_phoneservices_messages',
            '*',
            ['provider' => 'vonage'],
            'id',
            'DESC',
            (int) ($filters['limit'] ?? 50)
        );

        return $rows;
    }

    public function setSmsWebhook(string $url): bool
    {
        \PhoneServices\Core\Config::set('vonage_sms_webhook', $url);

        return true;
    }

    /* ==================================================================
     | Webhooks
     * ================================================================= */

    /**
     * Validate the JWT signature Vonage attaches to signed webhooks.
     */
    public function validateWebhookSignature(string $token): bool
    {
        $secret = (string) $this->cfg('signature_secret');

        if ($secret === '' || $token === '') {
            return false;
        }

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return false;
        }

        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $parts[0] . '.' . $parts[1], $secret, true)), '+/', '-_'), '=');

        return Crypto::secureCompare($expected, $parts[2]);
    }

    /* ==================================================================
     | Internals
     * ================================================================= */

    /**
     * @return array<string,string>
     */
    private function auth(): array
    {
        return [
            'api_key'    => (string) $this->cfg('api_key'),
            'api_secret' => (string) $this->cfg('api_secret'),
        ];
    }

    private function mapType(string $type): string
    {
        switch (strtolower($type)) {
            case 'toll_free':
            case 'tollfree':
                return 'landline-toll-free';
            case 'mobile':
                return 'mobile-lvn';
            default:
                return 'landline';
        }
    }

    private function countryForNumber(string $msisdn): string
    {
        foreach (self::dialCodes() as $iso => $code) {
            if (strpos($msisdn, $code) === 0) {
                return $iso;
            }
        }

        return 'US';
    }

    /**
     * Build an RS256 JWT for the Voice/RTC APIs from the application private
     * key. Returns '' when the application credentials are not configured.
     *
     * @param array<string,mixed> $extraClaims
     */
    private function applicationJwt(int $ttl = 3600, array $extraClaims = []): string
    {
        $applicationId = (string) $this->cfg('application_id');
        $privateKey = (string) \PhoneServices\Core\Config::get('vonage_private_key', '');

        if ($applicationId === '' || $privateKey === '' || !function_exists('openssl_sign')) {
            $this->lastError = 'Vonage application ID and private key are required for Voice/RTC';
            return '';
        }

        $now = time();
        $claims = array_merge([
            'application_id' => $applicationId,
            'iat'            => $now,
            'exp'            => $now + max(60, min($ttl, 86400)),
            'jti'            => bin2hex(random_bytes(8)),
        ], $extraClaims);

        $segments = [
            self::b64(json_encode(['typ' => 'JWT', 'alg' => 'RS256'])),
            self::b64(json_encode($claims)),
        ];

        $signature = '';
        $key = openssl_pkey_get_private($privateKey);

        if ($key === false) {
            $this->lastError = 'Vonage private key could not be parsed';
            return '';
        }

        openssl_sign(implode('.', $segments), $signature, $key, OPENSSL_ALGO_SHA256);

        if (PHP_VERSION_ID < 80000 && is_resource($key)) {
            openssl_free_key($key);
        }

        $segments[] = self::b64($signature);

        return implode('.', $segments);
    }

    private static function b64(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    public static function mapCallStatus(string $status): string
    {
        switch (strtolower($status)) {
            case 'started':
            case 'ringing':
                return 'ringing';
            case 'answered':
                return 'connected';
            case 'completed':
                return 'ended';
            case 'busy':
            case 'cancelled':
            case 'failed':
            case 'rejected':
            case 'timeout':
            case 'unanswered':
                return 'failed';
            default:
                return 'ended';
        }
    }

    public static function mapMessageStatus(string $status): string
    {
        switch (strtolower($status)) {
            case 'delivered':
                return 'delivered';
            case 'accepted':
            case 'buffered':
            case 'submitted':
                return 'sent';
            case 'expired':
            case 'failed':
            case 'rejected':
            case 'unknown':
                return 'failed';
            default:
                return 'unknown';
        }
    }
}
