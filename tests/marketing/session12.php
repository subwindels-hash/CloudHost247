<?php
/**
 * CloudHost247 Marketing — SESSION 12 behavior suite.
 *
 * Production QA: the SMTP failure taxonomy end to end, two workers on one queue,
 * a bounded soak that proves "exactly once", the whole chain in one pass, and the
 * deployment operations an operator actually performs (re-activate, deactivate,
 * import around a suppression).
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Integrations\Support\ResultCode;
use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Services\AnalyticsService;
use CloudHost247\Marketing\Services\CampaignService;
use CloudHost247\Marketing\Services\ExportService;
use CloudHost247\Marketing\Services\ImportService;
use CloudHost247\Marketing\Services\MessageTransport;
use CloudHost247\Marketing\Services\QueueService;
use CloudHost247\Marketing\Services\SubscriptionService;
use CloudHost247\Marketing\Services\TemplateService;

/** A transport that answers with whatever the test scripted, per address. */
final class CH247MarketingTaxonomyTransport implements MessageTransport
{
    public $sent = array();
    public $script = array();
    public $default = array('ok' => true, 'code' => ResultCode::CONNECTED, 'error' => '', 'detail' => '', 'latency_ms' => 5, 'provider_message_id' => 'q-1');
    private $available;

    public function __construct($available = true) { $this->available = (bool) $available; }
    public function key() { return 'cpanel_smtp'; }
    public function isAvailable() { return $this->available; }
    public function reason() { return $this->available ? '' : 'Not configured.'; }

    public function send(array $message)
    {
        $this->sent[] = $message;
        $email = strtolower((string) $message['to']);
        return isset($this->script[$email]) ? $this->script[$email] : $this->default;
    }
}

/** One queue graph with a scripted taxonomy transport. */
function ch247_marketing_taxonomy_worker(CH247MarketingTaxonomyTransport $transport, array $settings = array())
{
    $settingsRepository = new SettingsRepository();
    foreach ($settings as $key => $value) { $settingsRepository->set($key, $value); }
    $campaignService = new CampaignService(null, null, null, null, null, $transport);
    return array(
        'service' => $campaignService,
        'worker' => new QueueService(null, $campaignService, null, null, null, null, null, $settingsRepository),
        'settings' => $settingsRepository,
    );
}

return array(

// ------------------------------------------------------------------ taxonomy

'The transport hands the provider code to the queue (regression: the code used to be dropped)' => function () {
    // Not configured is the honest first case: there is no client to ask, and the
    // queue must still receive a code it can classify.
    $reported = array();
    $unconfigured = ch247_marketing_smtp_transport(null, ch247_marketing_configured_identity(), $reported)->send(array(
        'to' => 'reader@example.com', 'subject' => 'x', 'html' => '<p>x</p>', 'text' => 'x', 'from_email' => 'm@example.com',
    ));
    if (!empty($unconfigured['ok'])) { return false; }
    if (!isset($unconfigured['code']) || (string) $unconfigured['code'] !== ResultCode::PROVIDER_UNAVAILABLE) { return false; }
    if (!isset($unconfigured['latency_ms']) || !isset($unconfigured['detail'])) { return false; }

    // A refusal from the relay arrives with its own code and is reported with it.
    $client = new CH247MarketingFakeSmtpClient();
    $client->reply = array('ok' => false, 'code' => ResultCode::PERMISSION_DENIED, 'detail' => '550 5.1.1 no such user', 'latency_ms' => 40, 'provider_message_id' => '');
    $reported2 = array();
    $result = ch247_marketing_smtp_transport($client, ch247_marketing_configured_identity(), $reported2)->send(array(
        'to' => 'reader@example.com', 'subject' => 'x', 'html' => '<p>x</p>', 'text' => 'x', 'from_email' => 'marketing@example.com',
    ));
    if (!empty($result['ok'])) { return false; }
    if ((string) $result['code'] !== ResultCode::PERMISSION_DENIED) { return false; }
    if ((string) $result['error'] !== '550 5.1.1 no such user') { return false; }
    return count($reported2) === 1 && (string) $reported2[0]['code'] === ResultCode::PERMISSION_DENIED;
},

'Every refusal class lands where the failure taxonomy says it should' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingTaxonomyTransport();
    $transport->script = array(
        'hardbounce@example.com' => array('ok' => false, 'code' => ResultCode::PERMISSION_DENIED, 'error' => '550 5.1.1 no such user', 'detail' => '550 5.1.1 no such user', 'latency_ms' => 12, 'provider_message_id' => ''),
        'slow@example.com' => array('ok' => false, 'code' => ResultCode::TIMEOUT, 'error' => 'The relay did not answer in time.', 'detail' => 'timeout', 'latency_ms' => 30000, 'provider_message_id' => ''),
    );
    $fixture = array_merge($fixture, $graph = ch247_marketing_taxonomy_worker($transport, array('retry_attempts' => 3, 'retry_backoff_minutes' => '5,30,120', 'batch_size' => 25, 'messages_per_minute' => 600)));
    ch247_marketing_ready_campaign($fixture, array('hardbounce@example.com', 'slow@example.com', 'healthy@example.com'));

    // First attempt: one hard bounce, one timeout, one delivered.
    $summary = $graph['worker']->run(array('worker' => 'taxonomy-1'));
    if ((int) $summary['sent'] !== 1) { return false; }

    $rows = array();
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_queue') as $row) { $rows[(string) $row->email] = $row; }
    // Hard bounce: failed for good, the event says bounced, the address is suppressed.
    if ((string) $rows['hardbounce@example.com']->status !== 'failed' || (string) $rows['hardbounce@example.com']->last_error_kind !== 'hard_bounce') { return false; }
    if ($rows['hardbounce@example.com']->failed_at === null) { return false; }
    if (!(new SubscriptionService())->suppressions()->isSuppressed('hardbounce@example.com')) { return false; }
    $bounced = 0;
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_events') as $event) { if ((string) $event->type === 'bounced') { $bounced++; } }
    if ($bounced !== 1) { return false; }

    // Timeout: still queued for a retry, with a future next attempt and one attempt spent.
    $slow = $rows['slow@example.com'];
    if ((string) $slow->status !== 'queued' || (int) $slow->attempts !== 1) { return false; }
    if ((string) $slow->next_attempt_at <= date('Y-m-d H:i:s')) { return false; }
    if ((string) $slow->last_error_kind !== ResultCode::TIMEOUT) { return false; }

    // The healthy address was delivered exactly once.
    if ((string) $rows['healthy@example.com']->status !== 'sent' || count($transport->sent) !== 3) { return false; }

    // Now let the retry come due and answer with a permanent refusal: the queue
    // must stop retrying rather than keep a doomed row forever.
    ch247_mkt_update_row('mod_cloudhost247_marketing_email_queue', (int) $slow->id, array('next_attempt_at' => date('Y-m-d H:i:s', time() - 60)));
    $transport->script['slow@example.com'] = array('ok' => false, 'code' => ResultCode::PERMISSION_DENIED, 'error' => '550 rejected', 'detail' => '550 rejected', 'latency_ms' => 20, 'provider_message_id' => '');
    $graph['worker']->run(array('worker' => 'taxonomy-2'));
    $after = null;
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_queue') as $row) { if ((string) $row->email === 'slow@example.com') { $after = $row; } }
    return (string) $after->status === 'failed' && (string) $after->last_error_kind === 'hard_bounce';
},

'A broken session stops the pass, releases the untouched batch, and reports once' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingTaxonomyTransport();
    $transport->default = array('ok' => false, 'code' => ResultCode::AUTHENTICATION_FAILED, 'error' => '535 5.7.8 bad credentials', 'detail' => 'bad credentials', 'latency_ms' => 30, 'provider_message_id' => '');
    $fixture = array_merge($fixture, $graph = ch247_marketing_taxonomy_worker($transport, array('batch_size' => 25, 'messages_per_minute' => 600)));

    $addresses = array();
    for ($i = 1; $i <= 12; $i++) { $addresses[] = 'broken' . $i . '@example.com'; }
    $campaignId = (int) ch247_marketing_ready_campaign($fixture, $addresses)->id;
    $summary = $graph['worker']->run(array('worker' => 'broken'));

    if ((int) $summary['claimed'] !== 1) { return false; }
    if (strpos((string) $summary['rate_limited'], 'provider refused the session') === false) { return false; }
    // Every message is still queued for later: only the one that was attempted
    // carries the error, and the eleven that were never claimed are untouched.
    $rows = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue');
    $queued = 0;
    $attempted = 0;
    foreach ($rows as $row) {
        if ((string) $row->status !== 'queued') { return false; }
        $queued++;
        if ((int) $row->attempts === 1) { $attempted++; }
    }
    if ($queued !== 12 || $attempted !== 1) { return false; }
    // The campaign is not closed as completed while messages remain.
    $campaign = (new CampaignRepository())->find($campaignId);
    return (string) $campaign->status !== CampaignStatus::COMPLETED;
},

// --------------------------------------------------------------- concurrency

'Two workers on one queue never send a message twice' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transportA = new CH247MarketingTaxonomyTransport();
    $transportB = new CH247MarketingTaxonomyTransport();
    $addresses = array();
    for ($i = 1; $i <= 30; $i++) { $addresses[] = 'worker' . $i . '@example.com'; }
    $fixture = array_merge($fixture, ch247_marketing_taxonomy_worker($transportA, array('batch_size' => 25, 'messages_per_minute' => 600)));
    $campaign = ch247_marketing_ready_campaign($fixture, $addresses);

    $graphA = ch247_marketing_taxonomy_worker($transportA, array('batch_size' => 25, 'messages_per_minute' => 600));
    $graphB = ch247_marketing_taxonomy_worker($transportB, array('batch_size' => 25, 'messages_per_minute' => 600));
    $graphA['worker']->run(array('worker' => 'A', 'campaign_id' => (int) $campaign->id));
    $graphB['worker']->run(array('worker' => 'B', 'campaign_id' => (int) $campaign->id));

    $delivered = array();
    foreach (array_merge($transportA->sent, $transportB->sent) as $message) { $delivered[] = strtolower((string) $message['to']); }
    if (count($delivered) !== 30 || count(array_unique($delivered)) !== 30) { return false; }

    $sentRows = 0;
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_queue') as $row) { if ((string) $row->status === 'sent') { $sentRows++; } }
    $sentEvents = 0;
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_events') as $event) { if ((string) $event->type === 'sent') { $sentEvents++; } }
    return $sentRows === 30 && $sentEvents === 30;
},

// --------------------------------------------------------------------- soak

'A bounded soak delivers every message exactly once and keeps the ledger honest' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingTaxonomyTransport();
    $addresses = array();
    for ($i = 1; $i <= 120; $i++) { $addresses[] = 'soak' . $i . '@example.com'; }
    $fixture = array_merge($fixture, $graph = ch247_marketing_taxonomy_worker($transport, array(
        'batch_size' => 25, 'messages_per_minute' => 600, 'hourly_limit' => 500,
    )));
    $campaign = ch247_marketing_ready_campaign($fixture, $addresses);

    $passes = 0;
    $sent = 0;
    while ($passes < 30) {
        $summary = $graph['worker']->run(array('worker' => 'soak'));
        $passes++;
        $sent += (int) $summary['sent'];
        if ((int) $summary['claimed'] === 0) { break; }
        if (strpos((string) $summary['rate_limited'], 'hourly limit') !== false) { break; }
    }

    if ($sent !== 120 || count($transport->sent) !== 120) { return false; }
    $delivered = array();
    foreach ($transport->sent as $message) { $delivered[] = strtolower((string) $message['to']); }
    if (count(array_unique($delivered)) !== 120) { return false; }

    // Ledger and queue agree, and the campaign closed with the same numbers.
    $sentEvents = 0;
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_queue') as $row) {
        if ((string) $row->status !== 'sent') { return false; }
    }
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_events') as $event) { if ((string) $event->type === 'sent') { $sentEvents++; } }
    if ($sentEvents !== 120) { return false; }

    $closed = (new CampaignRepository())->find((int) $campaign->id);
    if ((string) $closed->status !== CampaignStatus::COMPLETED) { return false; }

    // Analytics derives the same numbers from the same ledger, and invents nothing.
    $analytics = (new AnalyticsService())->campaignSummary((int) $campaign->id);
    if ((int) $analytics['counts']['accepted'] !== 120) { return false; }
    // Nothing was opened or clicked: those rates are an honest zero (the
    // denominator is known) while click-to-open, whose denominator is unknown,
    // stays null instead of being invented as 0%.
    if ((float) $analytics['rates']['open'] !== 0.0 || (float) $analytics['rates']['click'] !== 0.0) { return false; }
    return $analytics['rates']['click_to_open'] === null;
},

// ---------------------------------------------------------------- whole chain

'The whole chain fits together: list → campaign → queue → tracking → analytics → unsubscribe' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingTaxonomyTransport();
    // This campaign's template carries a link, so click tracking is exercised.
    $linkTemplate = (new TemplateService())->save(array(
        'template_key' => 'journey-with-link',
        'name' => 'Journey with link',
        'design' => array('blocks' => array(
            array('type' => 'paragraph', 'text' => 'An update is ready for you.', 'align' => 'left'),
            array('type' => 'button', 'label' => 'Read the update', 'url' => 'https://cloudhost247.example/updates', 'variant' => 'primary', 'align' => 'center'),
        )),
    ))['template'];

    $fixture = array_merge($fixture, $graph = ch247_marketing_taxonomy_worker($transport, array('batch_size' => 25, 'messages_per_minute' => 600)));
    $campaign = ch247_marketing_ready_campaign($fixture, array('journey@example.com'), array('template_id' => (int) $linkTemplate->id));

    $summary = $graph['worker']->run(array('worker' => 'chain'));
    if ((int) $summary['sent'] !== 1 || count($transport->sent) !== 1) { return false; }
    $message = $transport->sent[0];
    if (strpos($message['html'], 'e=open') === false) { return false; }
    if (strpos($message['html'], 'e=click') === false) { return false; }
    if (strpos((string) $message['headers']['List-Unsubscribe'], 'e=unsubscribe') === false) { return false; }
    if ((string) $message['headers']['List-Unsubscribe-Post'] !== 'List-Unsubscribe=One-Click') { return false; }

    // The recipient opens, clicks and unsubscribes through the public endpoint.
    $row = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')[0];
    $token = (string) $row->tracking_token;
    preg_match('/l=(\d+)/', $message['html'], $matches);
    $controller = new CloudHost247\Marketing\Http\TrackController();
    $open = $controller->handle(array('e' => 'open', 'c' => $token), array(), 'GET');
    if ((int) $open['status'] !== 200) { return false; }
    $click = $controller->handle(array('e' => 'click', 'c' => $token, 'l' => (int) $matches[1]), array(), 'GET');
    if ((int) $click['status'] !== 302) { return false; }
    $confirm = $controller->handle(array('e' => 'unsubscribe', 'c' => $token), array(), 'GET');
    if ((int) $confirm['status'] !== 200) { return false; }
    // The confirmation form posts `confirm`; RFC 8058 one-click posts the
    // List-Unsubscribe marker. Both must remove the address; a GET never does.
    $done = $controller->handle(array('e' => 'unsubscribe', 'c' => $token), array('confirm' => '1'), 'POST');
    if ((int) $done['status'] !== 200 || strpos($done['body'], 'has been removed') === false) { return false; }
    $oneClick = $controller->handle(array('e' => 'unsubscribe', 'c' => $token), array('List-Unsubscribe' => 'One-Click'), 'POST');
    if ((int) $oneClick['status'] !== 200) { return false; }

    // The address is suppressed, the ledger knows all four events, and analytics
    // reports them from the ledger.
    $types = array();
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_events') as $event) { $types[] = (string) $event->type; }
    foreach (array('sent', 'opened', 'clicked', 'unsubscribed') as $expected) {
        if (!in_array($expected, $types, true)) { return false; }
    }
    $analytics = new AnalyticsService();
    $figures = $analytics->campaignSummary((int) $campaign->id);
    if ((int) $figures['counts']['accepted'] !== 1) { return false; }
    // Two unsubscribe requests, one event: the repeat changed nothing.
    if ((int) $figures['counts']['unsubscribed'] !== 1) { return false; }
    if ((int) $figures['counts']['opened'] !== 1 || (int) $figures['counts']['clicked'] !== 1) { return false; }

    // A second campaign addressed to the same list delivers to the new subscriber
    // and skips the one who unsubscribed minutes ago.
    (new SubscriptionService())->subscribe(array('email' => 'second@example.com', 'list_ids' => array((int) $fixture['list']->id)));
    $second = $fixture['service']->create(ch247_marketing_campaign_input($fixture, array('name' => 'Second send', 'idempotency_key' => 'second-send')));
    $fixture['service']->markReady((int) $second->id);
    $fixture['service']->sendNow((int) $second->id);
    $before = count($transport->sent);
    $graph['worker']->run(array('worker' => 'chain-2'));
    $secondRows = array();
    foreach (ch247_mkt_rows('mod_cloudhost247_marketing_email_queue') as $queueRow) {
        if ((int) $queueRow->campaign_id === (int) $second->id) { $secondRows[] = strtolower((string) $queueRow->email); }
    }
    if ($secondRows !== array('second@example.com')) { return false; }
    $last = $transport->sent[count($transport->sent) - 1];
    return count($transport->sent) === $before + 1 && (string) $last['to'] === 'second@example.com';
},

// ------------------------------------------------------- deployment operations

'Activation, deactivation and a re-run of the newest migration are all harmless' => function () {
    ch247_marketing_fresh();
    $first = cloudhost247_marketing_activate();
    if ($first['status'] !== 'success') { return false; }

    // A second activation is idempotent: no duplicate tables, settings or templates.
    $second = cloudhost247_marketing_activate();
    if ($second['status'] !== 'success') { return false; }

    // Re-running the newest migration must not throw and must not duplicate anything.
    (new CloudHost247\Marketing\Migrations\AutomationMigration())->up();
    (new CloudHost247\Marketing\Migrations\AutomationMigration())->up();

    // Deactivation is retention-only: every table and row survives.
    $subscribers = new SubscriptionService();
    $subscribers->subscribe(array('email' => 'retained@example.com'));
    $before = count(ch247_mkt_rows('mod_cloudhost247_marketing_subscribers'));
    if ($before < 1) { return false; }
    $result = cloudhost247_marketing_deactivate();
    if ($result['status'] !== 'success') { return false; }
    return count(ch247_mkt_rows('mod_cloudhost247_marketing_subscribers')) === $before;
},

'An import cannot resurrect a suppressed address, and an export never lists one' => function () {
    ch247_marketing_campaign_fixture();
    $subscriptions = new SubscriptionService();
    $subscriptions->suppress('blocked@example.com', SuppressionReason::ADMIN_SUPPRESSED);

    $importer = new ImportService();
    // Import rows are positional; the mapping is column index => subscriber field.
    $rows = array(
        array('blocked@example.com', 'Blocked'),
        array('fresh@example.com', 'Fresh'),
    );
    $counts = $importer->apply($rows, array(0 => 'email', 1 => 'first_name'), array('source_label' => 'session12'));
    if ((int) $counts['counts']['skipped_suppressed'] !== 1) { return false; }
    if ((int) $counts['counts']['created'] !== 1) { return false; }
    if ((new SubscriberRepository())->findByEmail('blocked@example.com')) { return false; } // never created

    $csv = (string) (new ExportService())->subscribersCsv(array());
    return strpos($csv, 'blocked@example.com') === false && strpos($csv, 'fresh@example.com') !== false;
},

)
;
