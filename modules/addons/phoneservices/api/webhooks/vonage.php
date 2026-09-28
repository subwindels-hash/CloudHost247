<?php
/**
 * Vonage webhook endpoint.
 *
 * Inbound SMS, delivery receipts and voice events. Signed webhooks (JWT in the
 * Authorization header) are verified when a signature secret is configured.
 *
 *   .../api/webhooks/vonage.php?event=sms
 *   .../api/webhooks/vonage.php?event=sms-status
 *   .../api/webhooks/vonage.php?event=call-status
 *   .../api/webhooks/vonage.php?event=voice
 *
 * @package PhoneServices
 */

require_once __DIR__ . '/../bootstrap.php';

use PhoneServices\Core\Config;
use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Providers\VonageProvider;
use PhoneServices\Services\SmsService;
use PhoneServices\Services\VoipService;

$event = (string) ($_GET['event'] ?? 'sms');
$headers = phoneservices_api_headers();

$payload = json_decode(phoneservices_api_raw_body(), true);
if (!is_array($payload)) {
    $payload = array_merge($_GET, $_POST);
}

/** @var VonageProvider|null $provider */
$provider = ProviderFactory::getProvider('vonage');

if (!$provider instanceof VonageProvider) {
    Logger::error('Vonage webhook received but the provider is unavailable');
    phoneservices_api_json(['success' => false, 'error' => 'Provider unavailable'], 503);
}

// Signature verification is enforced whenever a signature secret is set.
if ((string) Config::get('vonage_signature_secret', '') !== '') {
    $token = trim(str_ireplace('Bearer', '', (string) ($headers['authorization'] ?? '')));

    if (!$provider->validateWebhookSignature($token)) {
        Logger::warning('Rejected Vonage webhook: invalid signature', ['event' => $event]);
        phoneservices_api_json(['success' => false, 'error' => 'Invalid signature'], 403);
    }
}

phoneservices_api_record_event(
    'vonage',
    $event,
    $payload,
    (string) ($payload['messageId'] ?? ($payload['message-id'] ?? ($payload['uuid'] ?? '')))
);

switch ($event) {
    case 'sms':
        if (Config::isServiceEnabled('sms')) {
            (new SmsService())->receiveInboundMessage([
                'provider'   => 'vonage',
                'message_id' => (string) ($payload['messageId'] ?? ($payload['message-id'] ?? '')),
                'from'       => '+' . ltrim((string) ($payload['msisdn'] ?? ($payload['from'] ?? '')), '+'),
                'to'         => '+' . ltrim((string) ($payload['to'] ?? ''), '+'),
                'body'       => (string) ($payload['text'] ?? ''),
                'channel'    => 'sms',
            ]);
        }

        phoneservices_api_json(['success' => true]);
        break;

    case 'sms-status':
        $messageId = (string) ($payload['messageId'] ?? ($payload['message-id'] ?? ''));
        if ($messageId !== '') {
            Database::update('mod_phoneservices_messages', [
                'status'       => VonageProvider::mapMessageStatus((string) ($payload['status'] ?? '')),
                'delivered_at' => ($payload['status'] ?? '') === 'delivered' ? date('Y-m-d H:i:s') : null,
            ], ['message_id' => $messageId]);
        }

        phoneservices_api_json(['success' => true]);
        break;

    case 'call-status':
        $callId = (string) ($payload['uuid'] ?? '');
        if ($callId !== '') {
            (new VoipService())->updateCallStatus(
                $callId,
                VonageProvider::mapCallStatus((string) ($payload['status'] ?? '')),
                [
                    'duration' => (int) ($payload['duration'] ?? 0),
                    'cost'     => (float) ($payload['price'] ?? 0),
                    'from'     => (string) ($payload['from'] ?? ''),
                    'to'       => (string) ($payload['to'] ?? ''),
                ]
            );
        }

        phoneservices_api_json(['success' => true]);
        break;

    case 'voice':
    default:
        $voip = new VoipService();
        $callId = (string) ($payload['uuid'] ?? '');

        if ($callId !== '') {
            $voip->registerInboundCall([
                'provider'  => 'vonage',
                'call_id'   => $callId,
                'from'      => '+' . ltrim((string) ($payload['from'] ?? ''), '+'),
                'to'        => '+' . ltrim((string) ($payload['to'] ?? ''), '+'),
                'status'    => 'ringing',
                'direction' => 'inbound',
            ]);
        }

        // Answer with an NCCO that connects the caller to the owning client.
        header('Content-Type: application/json');
        echo json_encode($voip->buildInboundNcco((string) ($payload['to'] ?? ''), (string) ($payload['from'] ?? '')));
        exit;
}
