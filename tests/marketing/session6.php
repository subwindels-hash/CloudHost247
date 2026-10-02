<?php
/**
 * CloudHost247 Marketing — SESSION 6 behavior suite.
 *
 * The cPanel SMTP transport: vault-backed resolution, honest availability,
 * sender-domain policy and failure reporting. The SMTP wire protocol itself is
 * covered by tests/integrations (shared SmtpClient); here the transport is
 * exercised against scripted clients so every refusal path is deterministic.
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\CampaignAudience;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Services\CampaignService;
use CloudHost247\Marketing\Services\SmtpTransport;

/** A scripted stand-in for the shared integrations SMTP client. */
final class CH247MarketingFakeSmtpClient
{
    public $sent = array();
    public $reply = array('ok' => true, 'code' => 'connected', 'detail' => 'accepted', 'latency_ms' => 5, 'provider_message_id' => 'queued-1');

    public function send(array $message)
    {
        $this->sent[] = $message;
        return $this->reply;
    }
}

/** Builds a transport whose resolver/identity/reporter are scripted. */
function ch247_marketing_smtp_transport($client, array $identity = null, &$reported = null)
{
    $reported = array();
    return new SmtpTransport(
        function () use ($client) {
            return $client === null
                ? array('client' => null, 'reason' => 'The cPanel SMTP provider is not configured in API & Integrations yet.')
                : array('client' => $client, 'reason' => '');
        },
        function () use ($identity) { return $identity === null ? false : $identity; },
        function ($code, $detail) use (&$reported) { $reported[] = array('code' => $code, 'detail' => $detail); }
    );
}

function ch247_marketing_configured_identity()
{
    return array(
        'username' => 'marketing@example.com',
        'from_address' => 'news@example.com',
        'from_name' => 'CloudHost247',
        'reply_to' => 'support@example.com',
    );
}

return array(

// ------------------------------------------------------------- availability

'The SMTP transport reports availability with a reason and forwards messages verbatim' => function () {
    ch247_marketing_admin();
    $client = new CH247MarketingFakeSmtpClient();
    $reported = array();
    $transport = ch247_marketing_smtp_transport($client, ch247_marketing_configured_identity(), $reported);

    if ($transport->key() !== 'cpanel_smtp') { return false; }
    if (!$transport->isAvailable() || $transport->reason() !== '') { return false; }

    $message = array(
        'to' => 'reader@example.com', 'to_name' => '', 'subject' => 'October news',
        'html' => '<p>Hello</p>', 'text' => 'Hello',
        'from_email' => 'marketing@example.com', 'from_name' => 'CloudHost247', 'reply_to' => '',
        'headers' => array('X-CloudHost247-Campaign' => 1),
    );
    $result = $transport->send($message);
    if (!$result['ok'] || $result['provider_message_id'] !== 'queued-1') { return false; }
    if (count($client->sent) !== 1 || $client->sent[0] !== $message) { return false; }
    // A success is not an incident: nothing is reported to the event history.
    return $reported === array();
},

'An unconfigured provider refuses to send and explains what to fix' => function () {
    ch247_marketing_admin();
    $reported = array();
    $transport = ch247_marketing_smtp_transport(null, ch247_marketing_configured_identity(), $reported);

    if ($transport->isAvailable()) { return false; }
    if (strpos($transport->reason(), 'not configured') === false) { return false; }

    $result = $transport->send(array('to' => 'reader@example.com', 'from_email' => 'marketing@example.com', 'subject' => 'x', 'text' => 'x', 'html' => ''));
    return $result['ok'] === false && $result['error'] === $transport->reason() && $reported === array();
},

'A relay failure is surfaced and reported to the integrations event history' => function () {
    ch247_marketing_admin();
    $client = new CH247MarketingFakeSmtpClient();
    $client->reply = array('ok' => false, 'code' => 'authentication_failed', 'detail' => 'The relay rejected the submission credentials.', 'latency_ms' => 3, 'provider_message_id' => '');
    $reported = array();
    $transport = ch247_marketing_smtp_transport($client, ch247_marketing_configured_identity(), $reported);

    $result = $transport->send(array('to' => 'reader@example.com', 'from_email' => 'marketing@example.com', 'subject' => 'x', 'text' => 'x', 'html' => ''));
    if ($result['ok'] !== false) { return false; }
    if (strpos($result['error'], 'rejected the submission credentials') === false) { return false; }
    if (count($reported) !== 1) { return false; }
    return $reported[0]['code'] === 'authentication_failed';
},

// ---------------------------------------------------------- sender policy

'The sender-domain policy allows the mailbox domain and the configured from-address domain only' => function () {
    ch247_marketing_admin();
    $transport = ch247_marketing_smtp_transport(new CH247MarketingFakeSmtpClient(), ch247_marketing_configured_identity());

    $mailbox = $transport->senderPolicy('marketing@example.com');
    if (!$mailbox['ok'] || !$mailbox['enforced']) { return false; }
    if (strpos($mailbox['detail'], 'marketing@example.com') === false) { return false; }

    // The configured from_address domain is a second authorised domain.
    if (!$transport->senderPolicy('anything@example.com')['ok']) { return false; }

    // Another domain is refused, and the detail names both what is allowed and
    // what was asked for.
    $refused = $transport->senderPolicy('sales@other-domain.example');
    if ($refused['ok'] || !$refused['enforced']) { return false; }
    if (strpos($refused['detail'], 'example.com') === false || strpos($refused['detail'], 'other-domain.example') === false) { return false; }

    // A malformed sender cannot pass either.
    return $transport->senderPolicy('not-an-address')['ok'] === false;
},

'The policy is enforced at send time too, not only in the checklist' => function () {
    ch247_marketing_admin();
    $client = new CH247MarketingFakeSmtpClient();
    $transport = ch247_marketing_smtp_transport($client, ch247_marketing_configured_identity());

    $result = $transport->send(array(
        'to' => 'reader@example.com', 'from_email' => 'sales@other-domain.example',
        'subject' => 'x', 'text' => 'x', 'html' => '',
    ));
    return $result['ok'] === false
        && strpos($result['error'], 'spoofing') !== false
        && $client->sent === array();
},

'Without a configured provider the policy reports itself as not enforced' => function () {
    ch247_marketing_admin();
    $transport = ch247_marketing_smtp_transport(new CH247MarketingFakeSmtpClient(), null);
    $policy = $transport->senderPolicy('sales@other-domain.example');
    if ($policy['ok'] !== true || $policy['enforced'] !== false) { return false; }
    return $transport->identity() === null;
},

// --------------------------------------------------------- campaign wiring

'The campaign checklist gains a blocking sender-domain row once the provider states a policy' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = ch247_marketing_smtp_transport(new CH247MarketingFakeSmtpClient(), ch247_marketing_configured_identity());
    $service = new CampaignService(null, null, null, null, null, $transport);

    $campaign = $service->create(ch247_marketing_campaign_input($fixture));
    $checks = array();
    foreach ($service->checklist($campaign) as $check) { $checks[$check['key']] = $check; }
    if (!isset($checks['sender_domain'])) { return false; }
    if (!$checks['sender_domain']['ok'] || !$checks['sender_domain']['blocking']) { return false; }
    if (!$checks['transport']['ok']) { return false; } // a resolved provider is available
    if ($service->blockingIssues($campaign) !== array()) { return false; }

    // An off-domain sender blocks the schedule and names the reason.
    (new CampaignRepository())->update((int) $campaign->id, array('from_email' => 'sales@other-domain.example'));
    $offDomain = $service->blockingIssues((new CampaignRepository())->find((int) $campaign->id));
    if (count($offDomain) !== 1 || strpos($offDomain[0], 'Sender domain') !== 0) { return false; }

    try {
        $service->schedule((int) $campaign->id, date('Y-m-d H:i', time() + 3600), 'UTC');
        return false;
    } catch (RuntimeException $e) {
        return strpos($e->getMessage(), 'Sender domain') !== false;
    }
},

'A test send through the SMTP transport reaches the relay and is audited' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    ch247_marketing_seed_subscriber('reader@example.com');
    $client = new CH247MarketingFakeSmtpClient();
    $transport = ch247_marketing_smtp_transport($client, ch247_marketing_configured_identity());
    $service = new CampaignService(null, null, null, null, null, $transport);

    $campaign = $service->create(ch247_marketing_campaign_input($fixture, array('from_email' => 'marketing@example.com')));
    $result = $service->sendTest((int) $campaign->id, 'operator@example.com');
    if ($result['transport'] !== 'cpanel_smtp') { return false; }
    if (count($client->sent) !== 1 || $client->sent[0]['subject'] !== '[Test] October news') { return false; }
    return in_array('campaign.test_sent', ch247_marketing_audit_actions(), true);
},

'The marketing module never holds credentials: the transport only ever sees a client object' => function () {
    ch247_marketing_admin();
    // With the integrations addon absent (this test process never loads it) the
    // default transport reports that plainly instead of failing obscurely.
    $transport = new SmtpTransport();
    if ($transport->isAvailable()) { return false; }
    if (strpos($transport->reason(), 'API & Integrations') === false && strpos($transport->reason(), 'cPanel SMTP') === false) { return false; }

    $result = $transport->send(array('to' => 'reader@example.com', 'from_email' => 'marketing@example.com', 'subject' => 'x', 'text' => 'x', 'html' => ''));
    return $result['ok'] === false && $result['provider_message_id'] === '';
},

'The admin screens show the provider identity when one is configured' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    ch247_marketing_admin();
    // Inject a configured transport through the controller's campaign service.
    $controller = new CloudHost247\Marketing\Http\AdminController(
        null, null, null, null, null, null, null, null, null, null,
        new CampaignService(null, null, null, null, null,
            ch247_marketing_smtp_transport(new CH247MarketingFakeSmtpClient(), ch247_marketing_configured_identity()))
    );
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'campaigns');
    $_POST = array(); $_REQUEST = array();
    $data = $controller->handle();
    if (empty($data['campaignsView']['transport']['available'])) { return false; }
    $identity = $data['campaignsView']['transport']['identity'];
    return is_array($identity) && $identity['username'] === 'marketing@example.com';
},

);
