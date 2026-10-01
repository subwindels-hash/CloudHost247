<?php
/**
 * CloudHost247 Email Hosting - provider webhook endpoint.
 *
 * URL: https://<whmcs>/modules/servers/cloudhost247_email_hosting/webhook.php?provider=<key>
 *
 * Security model
 * --------------
 *  - Only providers with a documented, verifiable authentication scheme are
 *    accepted (see Webhook\Verifier::SUPPORTED). Everything else is refused
 *    with 501: an unauthenticated callback is never trusted.
 *  - Professional Email: HMAC-SHA256 over "timestamp.body" with the shared
 *    secret from the WHMCS-encrypted server access-hash JSON, 5 minute skew
 *    window, event ids recorded to block replays.
 *  - Microsoft Graph: validationToken handshake plus the clientState value the
 *    subscription was created with.
 *  - The endpoint only ever schedules a state refresh; it never provisions,
 *    deletes or bills anything, so a forged (but somehow verified) event cannot
 *    cause a destructive action.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

use CloudHost247\Email\Database\Migrator;
use CloudHost247\Email\Repository\AccountRepository;
use CloudHost247\Email\Service\Reconciler;
use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Support\Redactor;
use CloudHost247\Email\Support\Validator;
use CloudHost247\Email\Webhook\Verifier;
use WHMCS\Database\Capsule;

$whmcsRoot = null;

for ($levels = 3; $levels <= 6; $levels++) {
    $candidate = dirname(__DIR__, $levels);

    if (is_file($candidate . '/init.php')) {
        $whmcsRoot = $candidate;
        break;
    }
}

if ($whmcsRoot === null) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'WHMCS could not be initialised.']);
    exit;
}

require_once $whmcsRoot . '/init.php';
require_once __DIR__ . '/bootstrap.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/**
 * @param array<string,mixed> $payload
 */
function cloudhost247_email_hosting_webhook_respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function cloudhost247_email_hosting_webhook_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));

    return isset($_SERVER[$key]) ? trim((string) $_SERVER[$key]) : '';
}

Migrator::ensureSchema();
Logger::correlationId(true);

$provider = Validator::oneOf($_GET['provider'] ?? '', ['professional', 'microsoft365', 'google'], '');

if ($provider === '') {
    cloudhost247_email_hosting_webhook_respond(400, ['error' => 'Unknown provider.']);
}

// Microsoft Graph subscription handshake: echo the validation token verbatim.
$validationToken = isset($_GET['validationToken']) ? (string) $_GET['validationToken'] : '';

if ($provider === 'microsoft365' && $validationToken !== '') {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo substr($validationToken, 0, 2000);
    exit;
}

if (!in_array($provider, Verifier::SUPPORTED, true)) {
    Logger::warning('webhook.provider_unsupported', ['provider' => $provider]);

    cloudhost247_email_hosting_webhook_respond(501, [
        'error' => 'No authenticated webhook is documented for this provider; callbacks are refused. '
            . 'Status is kept current by the scheduled reconciler.',
    ]);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    cloudhost247_email_hosting_webhook_respond(405, ['error' => 'Method not allowed.']);
}

$rawBody = (string) file_get_contents('php://input');

if (strlen($rawBody) > 262144) {
    cloudhost247_email_hosting_webhook_respond(413, ['error' => 'Payload too large.']);
}

$payload = json_decode($rawBody, true);
$payload = is_array($payload) ? $payload : [];

/**
 * Resolve the shared secret / clientState from the server profile that owns
 * this provider. Credentials stay in WHMCS-encrypted storage.
 *
 * @return array<string,string>
 */
$serverSecrets = static function (string $provider): array {
    try {
        $servers = Capsule::table('tblservers')->where('type', 'cloudhost247_email_hosting')->where('disabled', 0)->get();
    } catch (\Throwable $e) {
        return [];
    }

    $secrets = [];

    foreach ($servers as $server) {
        $hash = Reconciler::decryptServerField((string) $server->accesshash);

        if ($hash === '' || strpos($hash, '{') === false) {
            continue;
        }

        $json = json_decode($hash, true);

        if (!is_array($json)) {
            continue;
        }

        if (!empty($json['webhook_secret'])) {
            $secrets[] = (string) $json['webhook_secret'];
        }

        if (!empty($json['client_state'])) {
            $secrets[] = (string) $json['client_state'];
        }
    }

    return $secrets;
};

$verified = false;
$reason = 'No matching credential configured.';
$eventId = '';
$eventType = '';
$affectedEmails = [];

if ($provider === 'professional') {
    $signature = cloudhost247_email_hosting_webhook_header('X-CloudHost247-Signature');
    $timestamp = cloudhost247_email_hosting_webhook_header('X-CloudHost247-Timestamp');
    $eventId = cloudhost247_email_hosting_webhook_header('X-CloudHost247-Event-Id');
    $eventType = Validator::text($payload['event'] ?? '', 96);

    foreach ($serverSecrets($provider) as $secret) {
        $check = Verifier::verifyHmac($rawBody, $signature, $secret, $timestamp);

        if ($check['valid']) {
            $verified = true;
            $reason = '';
            break;
        }

        $reason = $check['reason'];
    }

    $email = strtolower(Validator::text($payload['email'] ?? '', 191));

    if (Validator::isEmail($email)) {
        $affectedEmails[] = $email;
    }
} elseif ($provider === 'microsoft365') {
    // Graph sends an array of notifications, each carrying the clientState the
    // subscription was created with.
    $notifications = isset($payload['value']) && is_array($payload['value']) ? $payload['value'] : [];
    $secrets = $serverSecrets($provider);

    if (!$secrets) {
        $reason = 'No clientState is configured for Microsoft Graph notifications.';
    }

    foreach ($notifications as $notification) {
        $clientState = (string) ($notification['clientState'] ?? '');
        $matched = false;

        foreach ($secrets as $secret) {
            if ($secret !== '' && hash_equals($secret, $clientState)) {
                $matched = true;
                break;
            }
        }

        if (!$matched) {
            $verified = false;
            $reason = 'clientState mismatch.';
            break;
        }

        $verified = true;
        $reason = '';
        $eventId = $eventId !== '' ? $eventId : (string) ($notification['subscriptionId'] ?? '') . ':' . (string) ($notification['resource'] ?? '');
        $eventType = (string) ($notification['changeType'] ?? '');
    }
}

if ($eventId === '') {
    // Fall back to a content hash so replays are still detected.
    $eventId = substr(hash('sha256', $provider . '|' . $rawBody), 0, 64);
}

if (!$verified) {
    Verifier::remember($provider, $eventId, $eventType, $rawBody, false, 'rejected');

    Logger::warning('webhook.rejected', [
        'provider' => $provider,
        'reason'   => $reason,
        'event'    => Redactor::scrub($eventType),
    ]);

    cloudhost247_email_hosting_webhook_respond(401, ['error' => 'Signature verification failed.']);
}

// Replay protection: a verified event id is only ever processed once.
if (!Verifier::remember($provider, $eventId, $eventType, $rawBody, true, 'accepted')) {
    cloudhost247_email_hosting_webhook_respond(200, ['status' => 'duplicate_ignored']);
}

$queued = 0;

foreach ($affectedEmails as $email) {
    try {
        $account = Capsule::table('mod_cloudhost247_email_hosting_accounts')->where('email', $email)->first();
    } catch (\Throwable $e) {
        $account = null;
    }

    if (!$account) {
        continue;
    }

    // Webhooks never mutate anything directly: they only ask the reconciler to
    // re-read the authoritative state from the provider.
    AccountRepository::update((int) $account->service_id, [
        'last_sync_at'     => null,
        'last_sync_result' => 'webhook',
    ]);

    $queued++;
}

Logger::info('webhook.accepted', [
    'provider' => $provider,
    'event'    => Redactor::scrub($eventType),
    'queued'   => $queued,
]);

cloudhost247_email_hosting_webhook_respond(200, ['status' => 'accepted', 'queued' => $queued]);
