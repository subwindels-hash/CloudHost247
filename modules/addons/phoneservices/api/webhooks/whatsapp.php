<?php
/**
 * WhatsApp Business (Meta Cloud API) webhook endpoint.
 *
 * GET  - subscription verification handshake (hub.challenge).
 * POST - inbound messages and delivery statuses, verified with the
 *        X-Hub-Signature-256 HMAC of the raw body.
 *
 * @package PhoneServices
 */

require_once __DIR__ . '/../bootstrap.php';

use PhoneServices\Core\Config;
use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;
use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Providers\WhatsAppProvider;
use PhoneServices\Services\SmsService;

/** @var WhatsAppProvider|null $provider */
$provider = ProviderFactory::getProvider('whatsapp');

if (!$provider instanceof WhatsAppProvider) {
    phoneservices_api_json(['success' => false, 'error' => 'Provider unavailable'], 503);
}

// --- Subscription handshake ---------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $query = [];
    foreach ($_GET as $key => $value) {
        $query[str_replace('.', '_', $key)] = $value;
    }

    $challenge = $provider->handleSubscriptionChallenge($query);

    if ($challenge === null) {
        Logger::warning('WhatsApp webhook verification failed');
        phoneservices_api_json(['success' => false, 'error' => 'Verification failed'], 403);
    }

    header('Content-Type: text/plain');
    echo $challenge;
    exit;
}

// --- Event delivery ------------------------------------------------------
$rawBody = phoneservices_api_raw_body();

if (!$provider->verifyWebhook($rawBody, phoneservices_api_headers())) {
    phoneservices_api_json(['success' => false, 'error' => 'Invalid signature'], 403);
}

$payload = json_decode($rawBody, true);

if (!is_array($payload)) {
    phoneservices_api_json(['success' => false, 'error' => 'Malformed payload'], 400);
}

$smsService = new SmsService();

foreach ($provider->parseInboundWebhook($payload) as $record) {
    phoneservices_api_record_event('whatsapp', $record['kind'], $record, (string) ($record['message_id'] ?? ''));

    if ($record['kind'] === 'inbound' && Config::isServiceEnabled('sms')) {
        $smsService->receiveInboundMessage([
            'provider'   => 'whatsapp',
            'message_id' => (string) $record['message_id'],
            'from'       => (string) $record['from'],
            'to'         => (string) $record['to'],
            'body'       => (string) $record['body'],
            'channel'    => 'whatsapp',
        ]);
        continue;
    }

    if ($record['kind'] === 'status' && $record['message_id'] !== '') {
        Database::update('mod_phoneservices_messages', [
            'status'        => (string) $record['status'],
            'error_message' => $record['error'] ?? null,
            'delivered_at'  => $record['status'] === 'delivered' ? date('Y-m-d H:i:s') : null,
        ], ['message_id' => (string) $record['message_id']]);
    }
}

phoneservices_api_json(['success' => true]);
