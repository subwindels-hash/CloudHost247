<?php
/**
 * Twilio provider - numbers, voice, SMS and WebRTC.
 *
 * Talks to the Twilio REST API directly over the platform HTTP client. The
 * official SDK is optional: requiring it would force a Composer install on
 * every WHMCS host, and the REST surface we need is small and stable
 * (2010-04-01). WebRTC access tokens are minted as signed JWTs, matching
 * Twilio's Voice JS SDK expectations.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

use PhoneServices\Core\Crypto;
use PhoneServices\Interfaces\NumberProviderInterface;
use PhoneServices\Interfaces\SmsProviderInterface;
use PhoneServices\Interfaces\VoiceProviderInterface;

class TwilioProvider extends AbstractProvider implements NumberProviderInterface, VoiceProviderInterface, SmsProviderInterface
{
    const API_BASE = 'https://api.twilio.com/2010-04-01';
    const PRICING_BASE = 'https://pricing.twilio.com/v1';

    public function getName(): string
    {
        return 'twilio';
    }

    public function getCapabilities(): array
    {
        return ['numbers', 'voice', 'sms', 'webrtc'];
    }

    public function isAvailable(): bool
    {
        return $this->accountSid() !== '' && (string) $this->cfg('auth_token') !== '';
    }

    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            $this->lastError = 'Twilio credentials are incomplete';
            return false;
        }

        $response = $this->get($this->accountUrl('.json'), [], $this->authHeader());

        return (int) $response['status'] === 200;
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

        $country = strtoupper(substr($country, 0, 2));
        $resource = $this->numberTypeResource($type);

        $query = ['PageSize' => (int) ($filters['limit'] ?? 20)];

        if (!empty($filters['area_code'])) {
            $query['AreaCode'] = preg_replace('/[^0-9]/', '', (string) $filters['area_code']);
        }
        if (!empty($filters['contains'])) {
            $query['Contains'] = preg_replace('/[^0-9A-Za-z*]/', '', (string) $filters['contains']);
        }
        if (!empty($filters['sms_enabled'])) {
            $query['SmsEnabled'] = 'true';
        }
        if (!empty($filters['voice_enabled'])) {
            $query['VoiceEnabled'] = 'true';
        }

        $response = $this->get(
            $this->accountUrl('/AvailablePhoneNumbers/' . $country . '/' . $resource . '.json'),
            $query,
            $this->authHeader()
        );

        if ((int) $response['status'] !== 200) {
            return [];
        }

        $results = [];
        foreach ($response['body']['available_phone_numbers'] ?? [] as $entry) {
            $results[] = [
                'number'       => $entry['phone_number'] ?? '',
                'friendly'     => $entry['friendly_name'] ?? ($entry['phone_number'] ?? ''),
                'country'      => $entry['iso_country'] ?? $country,
                'type'         => $type,
                'region'       => $entry['region'] ?? ($entry['locality'] ?? ''),
                'locality'     => $entry['locality'] ?? '',
                'capabilities' => [
                    'voice' => (bool) ($entry['capabilities']['voice'] ?? false),
                    'sms'   => (bool) ($entry['capabilities']['SMS'] ?? ($entry['capabilities']['sms'] ?? false)),
                    'mms'   => (bool) ($entry['capabilities']['MMS'] ?? ($entry['capabilities']['mms'] ?? false)),
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
            return $this->failure('Twilio provider is not configured');
        }

        $payload = [
            'PhoneNumber'  => $this->formatE164($number, $country),
            'FriendlyName' => (string) ($options['friendly_name'] ?? ('PhoneServices ' . $number)),
            'VoiceUrl'     => (string) ($options['voice_url'] ?? $this->webhookUrl('voice')),
            'VoiceMethod'  => 'POST',
            'SmsUrl'       => (string) ($options['sms_url'] ?? $this->webhookUrl('sms')),
            'SmsMethod'    => 'POST',
            'StatusCallback' => (string) ($options['status_callback'] ?? $this->webhookUrl('status')),
        ];

        $response = $this->postForm($this->accountUrl('/IncomingPhoneNumbers.json'), $payload, $this->authHeader());
        $status = (int) $response['status'];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'Number purchase failed'), ['provider_status' => $status]);
        }

        $body = $response['body'] ?? [];

        return $this->success([
            'provider_reference' => $body['sid'] ?? '',
            'number'             => $body['phone_number'] ?? $payload['PhoneNumber'],
            'country'            => strtoupper($country),
            'capabilities'       => $body['capabilities'] ?? [],
            'provider'           => $this->getName(),
        ]);
    }

    public function releaseNumber(string $numberId): bool
    {
        if (!$this->isAvailable() || $numberId === '') {
            return false;
        }

        $response = $this->delete(
            $this->accountUrl('/IncomingPhoneNumbers/' . rawurlencode($numberId) . '.json'),
            $this->authHeader()
        );

        $status = (int) $response['status'];

        // 404 means it is already gone upstream - treat as released.
        return $status === 204 || $status === 200 || $status === 404;
    }

    /**
     * Twilio numbers renew automatically on their billing cycle; there is no
     * explicit renew call. We confirm the number is still owned and report the
     * next renewal date so the platform can bill for it.
     *
     * @return array<string,mixed>
     */
    public function renewNumber(string $numberId, int $months = 1): array
    {
        $details = $this->getNumberDetails($numberId);

        if (empty($details['success'])) {
            return $this->failure($details['error'] ?? 'Number not found upstream');
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
            return $this->failure('Twilio provider is not configured');
        }

        $response = $this->get(
            $this->accountUrl('/IncomingPhoneNumbers/' . rawurlencode($numberId) . '.json'),
            [],
            $this->authHeader()
        );

        if ((int) $response['status'] !== 200) {
            return $this->failure((string) ($response['error'] ?? 'Number lookup failed'));
        }

        $body = $response['body'] ?? [];

        return $this->success([
            'provider_reference' => $body['sid'] ?? $numberId,
            'number'             => $body['phone_number'] ?? '',
            'friendly_name'      => $body['friendly_name'] ?? '',
            'country'            => $body['iso_country'] ?? '',
            'capabilities'       => $body['capabilities'] ?? [],
            'voice_url'          => $body['voice_url'] ?? '',
            'sms_url'            => $body['sms_url'] ?? '',
            'status'             => $body['status'] ?? 'in-use',
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

        $map = [
            'voice_url'       => 'VoiceUrl',
            'sms_url'         => 'SmsUrl',
            'status_callback' => 'StatusCallback',
            'friendly_name'   => 'FriendlyName',
            'voice_fallback'  => 'VoiceFallbackUrl',
        ];

        $payload = [];
        foreach ($map as $key => $twilioKey) {
            if (isset($config[$key]) && $config[$key] !== '') {
                $payload[$twilioKey] = (string) $config[$key];
            }
        }

        if (!$payload) {
            return true;
        }

        $response = $this->postForm(
            $this->accountUrl('/IncomingPhoneNumbers/' . rawurlencode($numberId) . '.json'),
            $payload,
            $this->authHeader()
        );

        return (int) $response['status'] === 200;
    }

    /* ==================================================================
     | Voice
     * ================================================================= */

    /**
     * @return array<string,mixed>
     */
    public function initiateCall(string $from, string $to, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Twilio provider is not configured');
        }

        $payload = [
            'From' => $this->formatE164($from, $options['from_country'] ?? 'US'),
            'To'   => $this->formatE164($to, $options['to_country'] ?? 'US'),
            'StatusCallback'      => (string) ($options['status_callback'] ?? $this->webhookUrl('call-status')),
            'StatusCallbackEvent' => 'initiated ringing answered completed',
            'StatusCallbackMethod' => 'POST',
            'Timeout'             => (int) ($options['timeout'] ?? 30),
        ];

        if (!empty($options['twiml'])) {
            $payload['Twiml'] = (string) $options['twiml'];
        } else {
            $payload['Url'] = (string) ($options['url'] ?? $this->webhookUrl('voice'));
        }

        if (!empty($options['record'])) {
            $payload['Record'] = 'true';
        }

        $response = $this->postForm($this->accountUrl('/Calls.json'), $payload, $this->authHeader());
        $status = (int) $response['status'];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'Call could not be placed'), ['provider_status' => $status]);
        }

        $body = $response['body'] ?? [];

        return $this->success([
            'call_id'   => $body['sid'] ?? '',
            'status'    => self::mapCallStatus((string) ($body['status'] ?? 'queued')),
            'from'      => $body['from'] ?? $payload['From'],
            'to'        => $body['to'] ?? $payload['To'],
            'direction' => $body['direction'] ?? 'outbound-api',
            'provider'  => $this->getName(),
        ]);
    }

    public function endCall(string $callId): bool
    {
        if (!$this->isAvailable() || $callId === '') {
            return false;
        }

        $response = $this->postForm(
            $this->accountUrl('/Calls/' . rawurlencode($callId) . '.json'),
            ['Status' => 'completed'],
            $this->authHeader()
        );

        return (int) $response['status'] === 200;
    }

    /**
     * @return array<string,mixed>
     */
    public function getCallDetails(string $callId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Twilio provider is not configured');
        }

        $response = $this->get(
            $this->accountUrl('/Calls/' . rawurlencode($callId) . '.json'),
            [],
            $this->authHeader()
        );

        if ((int) $response['status'] !== 200) {
            return $this->failure((string) ($response['error'] ?? 'Call lookup failed'));
        }

        $body = $response['body'] ?? [];

        return $this->success([
            'call_id'    => $body['sid'] ?? $callId,
            'status'     => self::mapCallStatus((string) ($body['status'] ?? '')),
            'from'       => $body['from'] ?? '',
            'to'         => $body['to'] ?? '',
            'duration'   => (int) ($body['duration'] ?? 0),
            'cost'       => abs((float) ($body['price'] ?? 0)),
            'currency'   => $body['price_unit'] ?? 'USD',
            'direction'  => $body['direction'] ?? '',
            'started_at' => !empty($body['start_time']) ? date('Y-m-d H:i:s', strtotime($body['start_time'])) : null,
            'ended_at'   => !empty($body['end_time']) ? date('Y-m-d H:i:s', strtotime($body['end_time'])) : null,
        ]);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getCallLogs(array $filters = []): array
    {
        if (!$this->isAvailable()) {
            return [];
        }

        $query = ['PageSize' => (int) ($filters['limit'] ?? 50)];

        if (!empty($filters['from'])) {
            $query['From'] = $this->formatE164((string) $filters['from']);
        }
        if (!empty($filters['to'])) {
            $query['To'] = $this->formatE164((string) $filters['to']);
        }
        if (!empty($filters['start_date'])) {
            $query['StartTime>'] = date('Y-m-d', strtotime((string) $filters['start_date']));
        }
        if (!empty($filters['status'])) {
            $query['Status'] = (string) $filters['status'];
        }

        $response = $this->get($this->accountUrl('/Calls.json'), $query, $this->authHeader());

        if ((int) $response['status'] !== 200) {
            return [];
        }

        $logs = [];
        foreach ($response['body']['calls'] ?? [] as $call) {
            $logs[] = [
                'call_id'    => $call['sid'] ?? '',
                'from'       => $call['from'] ?? '',
                'to'         => $call['to'] ?? '',
                'status'     => self::mapCallStatus((string) ($call['status'] ?? '')),
                'duration'   => (int) ($call['duration'] ?? 0),
                'cost'       => abs((float) ($call['price'] ?? 0)),
                'currency'   => $call['price_unit'] ?? 'USD',
                'direction'  => $call['direction'] ?? '',
                'started_at' => !empty($call['start_time']) ? date('Y-m-d H:i:s', strtotime($call['start_time'])) : null,
                'ended_at'   => !empty($call['end_time']) ? date('Y-m-d H:i:s', strtotime($call['end_time'])) : null,
            ];
        }

        return $logs;
    }

    /**
     * Mint a Twilio Voice access token (JWT, HS256) for the browser SDK.
     *
     * Requires an API Key SID/Secret pair and a TwiML Application SID, which
     * is the credential set Twilio recommends for client-side tokens: the
     * account auth token is never exposed to the browser.
     */
    public function generateWebRtcToken(string $identity, int $ttl = 3600): string
    {
        $apiKey = (string) $this->cfg('api_key');
        $apiSecret = (string) $this->cfg('api_secret');
        $appSid = (string) $this->cfg('twiml_app_sid');

        if ($apiKey === '' || $apiSecret === '') {
            $this->logError('WebRTC token', 'Twilio API Key SID/Secret are required for browser calling');
            return '';
        }

        $identity = preg_replace('/[^A-Za-z0-9_.@-]/', '', $identity);
        $now = time();
        $ttl = max(60, min($ttl, 86400));

        $grants = ['identity' => $identity];
        $voiceGrant = ['incoming' => ['allow' => true]];

        if ($appSid !== '') {
            $voiceGrant['outgoing'] = ['application_sid' => $appSid];
        }

        $grants['voice'] = $voiceGrant;

        $header = ['typ' => 'JWT', 'alg' => 'HS256', 'cty' => 'twilio-fpa;v=1'];
        $payload = [
            'jti'    => $apiKey . '-' . $now,
            'iss'    => $apiKey,
            'sub'    => $this->accountSid(),
            'iat'    => $now,
            'nbf'    => $now - 5,
            'exp'    => $now + $ttl,
            'grants' => $grants,
        ];

        return self::jwtEncode($header, $payload, $apiSecret);
    }

    public function setVoiceWebhook(string $url): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }

        $numbers = $this->get($this->accountUrl('/IncomingPhoneNumbers.json'), ['PageSize' => 100], $this->authHeader());

        if ((int) $numbers['status'] !== 200) {
            return false;
        }

        $ok = true;
        foreach ($numbers['body']['incoming_phone_numbers'] ?? [] as $number) {
            if (empty($number['sid'])) {
                continue;
            }
            $ok = $this->updateNumberConfig((string) $number['sid'], ['voice_url' => $url]) && $ok;
        }

        return $ok;
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
            return $this->failure('Twilio provider is not configured');
        }

        if (trim($message) === '') {
            return $this->failure('Message body cannot be empty');
        }

        $payload = [
            'To'   => $this->formatE164($to, $options['country'] ?? 'US'),
            'Body' => $message,
            'StatusCallback' => (string) ($options['status_callback'] ?? $this->webhookUrl('sms-status')),
        ];

        if (!empty($options['messaging_service_sid'])) {
            $payload['MessagingServiceSid'] = (string) $options['messaging_service_sid'];
        } else {
            $payload['From'] = $this->formatE164($from, $options['country'] ?? 'US');
        }

        if (!empty($options['media_url'])) {
            $payload['MediaUrl'] = (string) $options['media_url'];
        }

        $response = $this->postForm($this->accountUrl('/Messages.json'), $payload, $this->authHeader());
        $status = (int) $response['status'];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'SMS send failed'), ['provider_status' => $status]);
        }

        $body = $response['body'] ?? [];

        return $this->success([
            'message_id' => $body['sid'] ?? '',
            'status'     => self::mapMessageStatus((string) ($body['status'] ?? 'queued')),
            'cost'       => abs((float) ($body['price'] ?? 0)),
            'segments'   => (int) ($body['num_segments'] ?? 1),
            'to'         => $body['to'] ?? $payload['To'],
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
     * @return array<string,mixed>
     */
    public function getMessageStatus(string $messageId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Twilio provider is not configured');
        }

        $response = $this->get(
            $this->accountUrl('/Messages/' . rawurlencode($messageId) . '.json'),
            [],
            $this->authHeader()
        );

        if ((int) $response['status'] !== 200) {
            return $this->failure((string) ($response['error'] ?? 'Message lookup failed'));
        }

        $body = $response['body'] ?? [];

        return $this->success([
            'message_id'    => $body['sid'] ?? $messageId,
            'status'        => self::mapMessageStatus((string) ($body['status'] ?? '')),
            'error_code'    => $body['error_code'] ?? null,
            'error_message' => $body['error_message'] ?? null,
            'cost'          => abs((float) ($body['price'] ?? 0)),
            'sent_at'       => !empty($body['date_sent']) ? date('Y-m-d H:i:s', strtotime($body['date_sent'])) : null,
        ]);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getMessageLogs(array $filters = []): array
    {
        if (!$this->isAvailable()) {
            return [];
        }

        $query = ['PageSize' => (int) ($filters['limit'] ?? 50)];

        if (!empty($filters['to'])) {
            $query['To'] = $this->formatE164((string) $filters['to']);
        }
        if (!empty($filters['from'])) {
            $query['From'] = $this->formatE164((string) $filters['from']);
        }
        if (!empty($filters['date'])) {
            $query['DateSent'] = date('Y-m-d', strtotime((string) $filters['date']));
        }

        $response = $this->get($this->accountUrl('/Messages.json'), $query, $this->authHeader());

        if ((int) $response['status'] !== 200) {
            return [];
        }

        $logs = [];
        foreach ($response['body']['messages'] ?? [] as $message) {
            $logs[] = [
                'message_id' => $message['sid'] ?? '',
                'from'       => $message['from'] ?? '',
                'to'         => $message['to'] ?? '',
                'body'       => $message['body'] ?? '',
                'status'     => self::mapMessageStatus((string) ($message['status'] ?? '')),
                'direction'  => $message['direction'] ?? '',
                'cost'       => abs((float) ($message['price'] ?? 0)),
                'sent_at'    => !empty($message['date_sent']) ? date('Y-m-d H:i:s', strtotime($message['date_sent'])) : null,
            ];
        }

        return $logs;
    }

    public function setSmsWebhook(string $url): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }

        $numbers = $this->get($this->accountUrl('/IncomingPhoneNumbers.json'), ['PageSize' => 100], $this->authHeader());

        if ((int) $numbers['status'] !== 200) {
            return false;
        }

        $ok = true;
        foreach ($numbers['body']['incoming_phone_numbers'] ?? [] as $number) {
            if (empty($number['sid'])) {
                continue;
            }
            $ok = $this->updateNumberConfig((string) $number['sid'], ['sms_url' => $url]) && $ok;
        }

        return $ok;
    }

    /* ==================================================================
     | Webhook verification
     * ================================================================= */

    /**
     * Validate the X-Twilio-Signature header for an inbound webhook.
     *
     * @param array<string,mixed> $params POST parameters exactly as received
     */
    public function validateWebhookSignature(string $url, array $params, string $signature): bool
    {
        $authToken = (string) $this->cfg('auth_token');

        if ($authToken === '' || $signature === '') {
            return false;
        }

        ksort($params);
        $data = $url;
        foreach ($params as $key => $value) {
            $data .= $key . (is_scalar($value) ? (string) $value : json_encode($value));
        }

        $expected = base64_encode(hash_hmac('sha1', $data, $authToken, true));

        return Crypto::secureCompare($expected, $signature);
    }

    /* ==================================================================
     | Internals
     * ================================================================= */

    private function accountSid(): string
    {
        return (string) $this->cfg('account_sid');
    }

    private function accountUrl(string $path): string
    {
        return self::API_BASE . '/Accounts/' . rawurlencode($this->accountSid()) . $path;
    }

    /**
     * @return array<string,string>
     */
    private function authHeader(): array
    {
        return [
            'Authorization' => \PhoneServices\Core\HttpClient::basicAuth($this->accountSid(), (string) $this->cfg('auth_token')),
            'Accept'        => 'application/json',
        ];
    }

    private function numberTypeResource(string $type): string
    {
        switch (strtolower($type)) {
            case 'toll_free':
            case 'tollfree':
                return 'TollFree';
            case 'mobile':
                return 'Mobile';
            case 'local':
            case 'second':
            default:
                return 'Local';
        }
    }

    /**
     * Normalise Twilio call states to the platform vocabulary
     * (ringing / connected / ended / failed).
     */
    public static function mapCallStatus(string $status): string
    {
        switch (strtolower($status)) {
            case 'queued':
            case 'initiated':
            case 'ringing':
                return 'ringing';
            case 'in-progress':
            case 'answered':
                return 'connected';
            case 'completed':
                return 'ended';
            case 'busy':
            case 'no-answer':
            case 'canceled':
            case 'failed':
                return 'failed';
            default:
                return 'ended';
        }
    }

    public static function mapMessageStatus(string $status): string
    {
        switch (strtolower($status)) {
            case 'queued':
            case 'accepted':
            case 'scheduled':
                return 'queued';
            case 'sending':
            case 'sent':
                return 'sent';
            case 'delivered':
                return 'delivered';
            case 'receiving':
            case 'received':
                return 'received';
            case 'undelivered':
            case 'failed':
                return 'failed';
            default:
                return 'unknown';
        }
    }

    /**
     * @param array<string,mixed> $header
     * @param array<string,mixed> $payload
     */
    private static function jwtEncode(array $header, array $payload, string $secret): string
    {
        $segments = [
            self::base64UrlEncode(json_encode($header)),
            self::base64UrlEncode(json_encode($payload)),
        ];

        $signingInput = implode('.', $segments);
        $segments[] = self::base64UrlEncode(hash_hmac('sha256', $signingInput, $secret, true));

        return implode('.', $segments);
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
