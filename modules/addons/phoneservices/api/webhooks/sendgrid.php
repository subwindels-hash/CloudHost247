<?php
/**
 * SendGrid Event Webhook endpoint.
 *
 * Records delivery/open/bounce events for emails sent by the platform and
 * mirrors the delivery state onto the message log.
 *
 * @package PhoneServices
 */

require_once __DIR__ . '/../bootstrap.php';

use PhoneServices\Core\Config;
use PhoneServices\Core\Crypto;
use PhoneServices\Core\Database;
use PhoneServices\Core\Logger;

$rawBody = phoneservices_api_raw_body();
$headers = phoneservices_api_headers();

// Optional shared-secret verification (set sendgrid_webhook_secret and add the
// same value as an "Authorization" header in the SendGrid event webhook).
$secret = (string) Config::get('sendgrid_webhook_secret', '');

if ($secret !== '') {
    $presented = trim(str_ireplace('Bearer', '', (string) ($headers['authorization'] ?? '')));

    if (!Crypto::secureCompare($secret, $presented)) {
        Logger::warning('Rejected SendGrid webhook: invalid secret');
        phoneservices_api_json(['success' => false, 'error' => 'Invalid signature'], 403);
    }
}

$events = json_decode($rawBody, true);

if (!is_array($events)) {
    phoneservices_api_json(['success' => false, 'error' => 'Malformed payload'], 400);
}

$statusMap = [
    'delivered'  => 'delivered',
    'processed'  => 'sent',
    'deferred'   => 'queued',
    'open'       => 'delivered',
    'click'      => 'delivered',
    'bounce'     => 'failed',
    'dropped'    => 'failed',
    'spamreport' => 'failed',
    'blocked'    => 'failed',
];

$processed = 0;

foreach ($events as $event) {
    if (!is_array($event)) {
        continue;
    }

    $messageId = (string) ($event['phoneservices_id'] ?? ($event['sg_message_id'] ?? ''));
    phoneservices_api_record_event('sendgrid', (string) ($event['event'] ?? 'unknown'), $event, $messageId);

    $status = $statusMap[strtolower((string) ($event['event'] ?? ''))] ?? null;

    if ($status !== null && $messageId !== '') {
        Database::update('mod_phoneservices_messages', [
            'status'       => $status,
            'delivered_at' => $status === 'delivered' ? date('Y-m-d H:i:s') : null,
        ], ['message_id' => $messageId]);
    }

    $processed++;
}

phoneservices_api_json(['success' => true, 'processed' => $processed]);
