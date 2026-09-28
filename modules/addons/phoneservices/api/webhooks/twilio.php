<?php
/**
 * Twilio webhook endpoint.
 *
 * Handles inbound SMS, inbound/outbound voice events and delivery receipts.
 * Every request is authenticated with the X-Twilio-Signature HMAC before any
 * state is changed.
 *
 * Configure in Twilio (or let the module do it via "Set webhooks"):
 *   .../api/webhooks/twilio.php?event=sms
 *   .../api/webhooks/twilio.php?event=voice
 *   .../api/webhooks/twilio.php?event=sms-status
 *   .../api/webhooks/twilio.php?event=call-status
 *
 * @package PhoneServices
 */

require_once __DIR__ . '/../bootstrap.php';

use PhoneServices\Core\Config;
use PhoneServices\Core\Logger;
use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Providers\TwilioProvider;
use PhoneServices\Services\SmsService;
use PhoneServices\Services\VoipService;

$event = (string) ($_GET['event'] ?? ($_GET['type'] ?? 'sms'));
$headers = phoneservices_api_headers();
$signature = (string) ($headers['x-twilio-signature'] ?? '');

/** @var TwilioProvider|null $provider */
$provider = ProviderFactory::getProvider('twilio');

if (!$provider instanceof TwilioProvider) {
    Logger::error('Twilio webhook received but the provider is unavailable');
    phoneservices_api_json(['success' => false, 'error' => 'Provider unavailable'], 503);
}

if (!$provider->validateWebhookSignature(phoneservices_api_current_url(), $_POST, $signature)) {
    Logger::warning('Rejected Twilio webhook: invalid signature', ['event' => $event]);
    phoneservices_api_json(['success' => false, 'error' => 'Invalid signature'], 403);
}

phoneservices_api_record_event('twilio', $event, $_POST, (string) ($_POST['MessageSid'] ?? ($_POST['CallSid'] ?? '')));

switch ($event) {
    case 'sms':
        if (Config::isServiceEnabled('sms')) {
            (new SmsService())->receiveInboundMessage([
                'provider'   => 'twilio',
                'message_id' => (string) ($_POST['MessageSid'] ?? ''),
                'from'       => (string) ($_POST['From'] ?? ''),
                'to'         => (string) ($_POST['To'] ?? ''),
                'body'       => (string) ($_POST['Body'] ?? ''),
                'channel'    => 'sms',
            ]);
        }

        header('Content-Type: text/xml');
        echo '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
        exit;

    case 'sms-status':
    case 'status':
        $messageId = (string) ($_POST['MessageSid'] ?? '');
        if ($messageId !== '') {
            \PhoneServices\Core\Database::update('mod_phoneservices_messages', [
                'status'        => TwilioProvider::mapMessageStatus((string) ($_POST['MessageStatus'] ?? '')),
                'error_message' => $_POST['ErrorMessage'] ?? null,
                'delivered_at'  => ($_POST['MessageStatus'] ?? '') === 'delivered' ? date('Y-m-d H:i:s') : null,
            ], ['message_id' => $messageId]);
        }

        phoneservices_api_json(['success' => true]);
        break;

    case 'call-status':
        $callId = (string) ($_POST['CallSid'] ?? '');
        if ($callId !== '') {
            (new VoipService())->updateCallStatus(
                $callId,
                TwilioProvider::mapCallStatus((string) ($_POST['CallStatus'] ?? '')),
                [
                    'duration' => (int) ($_POST['CallDuration'] ?? 0),
                    'cost'     => abs((float) ($_POST['Price'] ?? 0)),
                    'from'     => (string) ($_POST['From'] ?? ''),
                    'to'       => (string) ($_POST['To'] ?? ''),
                ]
            );
        }

        phoneservices_api_json(['success' => true]);
        break;

    case 'voice':
    default:
        $callId = (string) ($_POST['CallSid'] ?? '');
        $voip = new VoipService();

        if ($callId !== '') {
            $voip->registerInboundCall([
                'provider'  => 'twilio',
                'call_id'   => $callId,
                'from'      => (string) ($_POST['From'] ?? ''),
                'to'        => (string) ($_POST['To'] ?? ''),
                'status'    => TwilioProvider::mapCallStatus((string) ($_POST['CallStatus'] ?? 'ringing')),
                'direction' => (string) ($_POST['Direction'] ?? 'inbound'),
            ]);
        }

        // Bridge the inbound call to the browser client that owns the number.
        header('Content-Type: text/xml');
        echo $voip->buildInboundTwiml((string) ($_POST['To'] ?? ''), (string) ($_POST['From'] ?? ''));
        exit;
}
