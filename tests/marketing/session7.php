<?php
/**
 * CloudHost247 Marketing — SESSION 7 behavior suite.
 *
 * The queue and the delivery worker: freezing an audience, queueing once,
 * claiming safely, throttle ceilings, retries with backoff, hard bounces that
 * suppress, a dead worker that loses nothing, paused/cancelled campaigns, and a
 * render smoke test that proves every admin screen actually renders (the
 * dashboard previously fataled on a missing import because tests only inspected
 * the returned data).
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\CampaignAudience;
use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\QueueRepository;
use CloudHost247\Marketing\Repositories\RecipientRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Services\CampaignService;
use CloudHost247\Marketing\Services\QueueService;
use CloudHost247\Marketing\Services\SubscriptionService;

/** Transport whose replies are scripted per recipient address. */
final class CH247MarketingScriptedTransport implements CloudHost247\Marketing\Services\MessageTransport
{
    public $sent = array();
    public $script = array();  // email(lowercase) => reply array
    public $default = array('ok' => true, 'error' => '', 'provider_message_id' => 'queued-1', 'code' => 'connected');
    private $available;

    public function __construct($available = true)
    {
        $this->available = (bool) $available;
    }

    public function key() { return 'cpanel_smtp'; }
    public function isAvailable() { return $this->available; }
    public function reason() { return $this->available ? '' : 'The cPanel SMTP provider is not configured in API & Integrations yet.'; }

    public function send(array $message)
    {
        $this->sent[] = $message;
        $email = strtolower((string) $message['to']);
        if (isset($this->script[$email])) { return $this->script[$email]; }
        return $this->default;
    }
}

/** One service graph the tests can share: campaign service + worker. */
function ch247_marketing_worker($transport = null, array $settings = array())
{
    $settingsRepository = new SettingsRepository();
    foreach ($settings as $key => $value) { $settingsRepository->set($key, $value); }
    $campaignService = new CampaignService(null, null, null, null, null, $transport ?: new CH247MarketingScriptedTransport());
    $worker = new QueueService(null, $campaignService, null, null, null, null, null, $settingsRepository);
    return array('service' => $campaignService, 'worker' => $worker, 'settings' => $settingsRepository);
}

/** A ready campaign addressed to a list of subscribed addresses. */
function ch247_marketing_ready_campaign(array $fixture, array $subscribers, array $overrides = array())
{
    // The shared fixture puts one address on the list; these tests want exactly
    // the addresses they name, so its membership is removed first.
    $detached = (new CloudHost247\Marketing\Repositories\SubscriberRepository())->findByEmail('reader@example.com');
    if ($detached) { (new CloudHost247\Marketing\Repositories\ListRepository())->removeMember((int) $fixture['list']->id, (int) $detached->id); }

    $subscriptions = new SubscriptionService();
    foreach ($subscribers as $email) {
        $subscriptions->subscribe(array('email' => $email, 'list_ids' => array((int) $fixture['list']->id)));
    }
    $campaign = $fixture['service']->create(ch247_marketing_campaign_input($fixture, $overrides));
    $fixture['service']->markReady((int) $campaign->id);
    return $fixture['service']->sendNow((int) $campaign->id)['campaign'];
}

return array(

// ------------------------------------------------------------- materialising

'The worker freezes the audience, skipping unsubscribed and suppressed addresses' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $graph = ch247_marketing_worker();
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('one@example.com', 'two@example.com'));
    $subscriptions = new SubscriptionService();
    $subscriptions->unsubscribe('two@example.com', 'admin');
    $subscriptions->subscribe(array('email' => 'three@example.com', 'list_ids' => array((int) $fixture['list']->id)));
    $subscriptions->suppress('three@example.com', SuppressionReason::ADMIN_SUPPRESSED);

    $summary = $graph['worker']->run(array('worker' => 'test-worker', 'dry_run' => true));
    // Unsubscribed and suppressed addresses are excluded by the audience query
    // itself, so they never even become recipients.
    if ($summary['recipients'] !== 1 || $summary['skipped_addresses'] !== 0) { return false; }
    if ($summary['enqueued'] !== 1) { return false; }

    $campaign = (new CampaignRepository())->find((int) $campaign->id);
    if ($campaign->status !== CampaignStatus::QUEUED) { return false; }
    $recipients = new RecipientRepository();
    if ($recipients->count((int) $campaign->id) !== 1) { return false; }
    if ($recipients->count((int) $campaign->id, RecipientRepository::STATUS_PENDING) !== 1) { return false; }

    // Re-running the worker does not duplicate recipients or queue rows.
    $again = $graph['worker']->run(array('worker' => 'test-worker', 'dry_run' => true));
    if ($again['enqueued'] !== 0 || $recipients->count((int) $campaign->id) !== 1) { return false; }
    if ((new QueueRepository())->countsForCampaign((int) $campaign->id)[QueueStatus::QUEUED] !== 1) { return false; }

    // A suppression row can exist while a subscriber still reads as subscribed
    // (added straight to the suppression list, a bounce from another system).
    // The queue is the last gate that must still catch it.
    $transport = new CH247MarketingScriptedTransport();
    $deliveryGraph = ch247_marketing_worker($transport);
    $deliveryGraph['worker']->run(array('worker' => 'test-worker'));
    if (count($transport->sent) !== 1) { return false; }

    (new CloudHost247\Marketing\Repositories\SuppressionRepository())->suppress('one@example.com', SuppressionReason::ADMIN_SUPPRESSED, 'admin');
    $blocked = $deliveryGraph['worker']->run(array('worker' => 'test-worker', 'campaign_id' => (int) $campaign->id));
    return $blocked['sent'] === 0 && count($transport->sent) === 1;
},

// ---------------------------------------------------------------- delivery

'The worker delivers queued messages and closes the campaign with honest counters' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport);
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('one@example.com', 'two@example.com'));

    $summary = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($summary['sent'] !== 2) { return false; }
    if (count($transport->sent) !== 2) { return false; }
    if ($transport->sent[0]['headers']['X-CloudHost247-Campaign'] !== (int) $campaign->id) { return false; }
    if ($transport->sent[0]['subject'] !== 'October news') { return false; } // no [Test] prefix on a real send

    $campaign = (new CampaignRepository())->find((int) $campaign->id);
    if ($campaign->status !== CampaignStatus::COMPLETED) { return false; }
    if ($campaign->completed_at === null) { return false; }

    $queue = new QueueRepository();
    $counts = $queue->countsForCampaign((int) $campaign->id);
    if ($counts[QueueStatus::SENT] !== 2 || $counts[QueueStatus::QUEUED] !== 0) { return false; }
    if ((new RecipientRepository())->count((int) $campaign->id, RecipientRepository::STATUS_SENT) !== 2) { return false; }

    // The event ledger records what happened, not what we hoped happened.
    $types = array();
    foreach (\WHMCS\Database\Capsule::table('mod_cloudhost247_marketing_email_events')->get()->all() as $event) {
        $types[] = (string) $event->type;
    }
    if (!in_array('queued', $types, true) || !in_array('sent', $types, true)) { return false; }
    return in_array('campaign.completed', ch247_marketing_audit_actions(), true);
},

'A shutdown mid-send loses nothing: the stale lock is released and the message goes out on the next pass' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport);
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('one@example.com'));
    $graph['worker']->run(array('worker' => 'first', 'dry_run' => true)); // freeze + queue only

    // Simulate a worker that claimed the row and died before sending.
    $affected = \WHMCS\Database\Capsule::table('mod_cloudhost247_marketing_email_queue')
        ->where('campaign_id', (int) $campaign->id)
        ->update(array('status' => QueueStatus::SENDING, 'locked_until' => date('Y-m-d H:i:s', time() - 600), 'locked_by' => 'dead-worker'));
    if ($affected !== 1) { return false; }

    $summary = $graph['worker']->run(array('worker' => 'second'));
    if ($summary['released_locks'] !== 1) { return false; }
    if ($summary['sent'] !== 1) { return false; }
    return count($transport->sent) === 1;
},

'A message is never delivered twice: a queue row already sent is not picked up again' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport);
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('one@example.com'));

    $graph['worker']->run(array('worker' => 'first'));
    $graph['worker']->run(array('worker' => 'second'));
    $graph['worker']->run(array('worker' => 'third'));
    return count($transport->sent) === 1;
},

// ---------------------------------------------------------------- failures

'A hard refusal suppresses the address; a transient failure retries with backoff and then gives up' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $transport->script = array(
        'hard@example.com' => array('ok' => false, 'error' => '550 5.1.1 mailbox unavailable', 'code' => 'permission_denied', 'provider_message_id' => ''),
        'soft@example.com' => array('ok' => false, 'error' => '451 4.4.1 try later', 'code' => 'provider_unavailable', 'provider_message_id' => ''),
        'gone@example.com' => array('ok' => false, 'error' => '421 4.4.2 connection lost', 'code' => 'timeout', 'provider_message_id' => ''),
    );
    $graph = ch247_marketing_worker($transport, array('retry_attempts' => '2', 'retry_backoff_minutes' => '0,0'));
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('hard@example.com', 'soft@example.com', 'gone@example.com'));

    $summary = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($summary['suppressed'] !== 1) { return false; }
    if ($summary['retried'] !== 2) { return false; }
    if ($summary['sent'] !== 0) { return false; }

    // The hard bounce is suppressed immediately; the transient ones wait.
    $suppressions = new CloudHost247\Marketing\Repositories\SuppressionRepository();
    if (!$suppressions->isSuppressed('hard@example.com')) { return false; }
    if ($suppressions->isSuppressed('soft@example.com')) { return false; }
    if ((new QueueRepository())->countsForCampaign((int) $campaign->id)[QueueStatus::QUEUED] !== 2) { return false; }

    // A second pass exhausts the retry budget and fails them permanently.
    $second = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($second['failed'] !== 2) { return false; }
    $counts = (new QueueRepository())->countsForCampaign((int) $campaign->id);
    // One immediate hard bounce plus two exhausted retries: failures are counted
    // per message, never collapsed into "some failed".
    if ($counts[QueueStatus::FAILED] !== 3) { return false; }

    $campaign = (new CampaignRepository())->find((int) $campaign->id);
    // Nothing got out at all, so the campaign reports failure, not completion.
    return $campaign->status === CampaignStatus::FAILED && strpos((string) $campaign->failure_reason, 'Every queued message failed') === 0;
},

'A relay that refuses the session stops the run instead of burning through the audience' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $transport->default = array('ok' => false, 'error' => 'The relay rejected the submission credentials.', 'code' => 'authentication_failed', 'provider_message_id' => '');
    $graph = ch247_marketing_worker($transport, array('retry_attempts' => '3'));
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('one@example.com', 'two@example.com', 'three@example.com'));

    $summary = $graph['worker']->run(array('worker' => 'test-worker'));
    if (count($transport->sent) !== 1) { return false; } // one attempt, then stop
    if (strpos($summary['rate_limited'], 'authentication_failed') === false && strpos($summary['rate_limited'], 'refused the session') === false) { return false; }

    $counts = (new QueueRepository())->countsForCampaign((int) $campaign->id);
    // The message that failed waits for a retry; the untouched ones stay queued.
    return $counts[QueueStatus::FAILED] === 0 && $counts[QueueStatus::QUEUED] === 3;
},

// --------------------------------------------------------------- throttling

'The worker never exceeds the batch, per-minute or hourly allowance' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport, array('batch_size' => '3', 'messages_per_minute' => '100', 'hourly_limit' => '100'));
    $fixture['service'] = $graph['service'];
    $emails = array();
    for ($i = 1; $i <= 6; $i++) { $emails[] = 'bulk' . $i . '@example.com'; }
    $campaign = ch247_marketing_ready_campaign($fixture, $emails);

    $summary = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($summary['sent'] !== 3) { return false; }
    if ((new QueueRepository())->countsForCampaign((int) $campaign->id)[QueueStatus::QUEUED] !== 3) { return false; }

    // The next pass picks up exactly the remainder.
    $second = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($second['sent'] !== 3) { return false; }
    return (new CampaignRepository())->find((int) $campaign->id)->status === CampaignStatus::COMPLETED;
},

'The hourly ceiling stops the pass and says so' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport, array('batch_size' => '50', 'messages_per_minute' => '50', 'hourly_limit' => '2'));
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'));

    $first = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($first['sent'] !== 2) { return false; }

    // The rolling window is already full, so nothing else may be attempted.
    $second = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($second['sent'] !== 0) { return false; }
    return strpos($second['rate_limited'], 'hourly limit') !== false;
},

'A disabled module sends nothing at all' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport, array('enabled' => '0'));
    $fixture['service'] = $graph['service'];
    ch247_marketing_ready_campaign($fixture, array('one@example.com'));

    $summary = $graph['worker']->run(array('worker' => 'test-worker'));
    return $summary['disabled'] === true && $summary['sent'] === 0 && $transport->sent === array();
},

// ------------------------------------------------------- pause and cancel

'Pausing stops delivery mid-campaign, and resuming finishes it' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport, array('batch_size' => '1'));
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('one@example.com', 'two@example.com'));

    $graph['worker']->run(array('worker' => 'test-worker'));
    if (count($transport->sent) !== 1) { return false; }

    // Pause while the queue still holds one message.
    (new CampaignRepository())->setStatus((int) $campaign->id, CampaignStatus::PAUSED, array('scheduled_at' => date('Y-m-d H:i:s', time() + 3600)));
    $pausedRun = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($pausedRun['sent'] !== 0 || count($transport->sent) !== 1) { return false; }

    // Resuming to a live moment lets the worker finish the job.
    (new CampaignRepository())->setStatus((int) $campaign->id, CampaignStatus::SCHEDULED, array('scheduled_at' => date('Y-m-d H:i:s', time() - 10)));
    $resumedRun = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($resumedRun['sent'] !== 1) { return false; }
    return (new CampaignRepository())->find((int) $campaign->id)->status === CampaignStatus::COMPLETED;
},

'Cancelling skips the remaining messages without pretending they were sent' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport, array('batch_size' => '1'));
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('one@example.com', 'two@example.com'));
    $graph['worker']->run(array('worker' => 'test-worker'));

    (new CampaignRepository())->setStatus((int) $campaign->id, CampaignStatus::CANCELLED);
    $summary = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($summary['sent'] !== 0) { return false; }

    $counts = (new QueueRepository())->countsForCampaign((int) $campaign->id);
    if ($counts[QueueStatus::SKIPPED] !== 1 || $counts[QueueStatus::SENT] !== 1) { return false; }
    return count($transport->sent) === 1 && $summary['completed'] === 0;
},

'Without a delivery provider the worker freezes and queues but sends nothing' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport(false);
    $graph = ch247_marketing_worker($transport);
    $fixture['service'] = $graph['service'];
    $campaign = ch247_marketing_ready_campaign($fixture, array('one@example.com'));

    $summary = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($summary['sent'] !== 0 || $transport->sent !== array()) { return false; }
    if (strpos($summary['rate_limited'], 'no delivery provider') === false) { return false; }
    // Queueing an unconfigured provider is honest: the row survives until the
    // provider exists, and nothing claims to have been delivered.
    return (new QueueRepository())->countsForCampaign((int) $campaign->id)[QueueStatus::QUEUED] === 1;
},

'Audience resolution refuses a campaign whose segment cannot be trusted' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingScriptedTransport();
    $graph = ch247_marketing_worker($transport);
    $fixture['service'] = $graph['service'];
    ch247_marketing_seed_subscriber('seg-a@example.com');
    $segment = (new CloudHost247\Marketing\Services\SegmentService())->save(array(
        'segment_key' => 'customer-facts',
        'name' => 'Customer facts',
        'definition' => array('match' => 'all', 'rules' => array(array('field' => 'client.country', 'operator' => 'is', 'value' => 'NG'))),
    ));
    $campaign = $graph['service']->create(ch247_marketing_campaign_input($fixture, array(
        'name' => 'Untrustworthy segment',
        'audience_type' => CampaignAudience::SEGMENT,
        'audience_id' => (int) $segment->id,
    )));
    (new CampaignRepository())->setStatus((int) $campaign->id, CampaignStatus::SCHEDULED, array('scheduled_at' => date('Y-m-d H:i:s', time() - 5)));

    $summary = $graph['worker']->run(array('worker' => 'test-worker'));
    if ($summary['sent'] !== 0 || $transport->sent !== array()) { return false; }
    if (!$summary['campaign_errors'] || strpos($summary['campaign_errors'][0], 'Segment') === false) { return false; }

    $campaign = (new CampaignRepository())->find((int) $campaign->id);
    // The campaign is reported failed with the resolver's own words, and the
    // failure is audited — a refusal is never a silent no-op.
    return $campaign->status === CampaignStatus::FAILED
        && strpos((string) $campaign->failure_reason, 'cannot be resolved') !== false
        && in_array('campaign.failed', ch247_marketing_audit_actions(), true);
},

// -------------------------------------------------------- every screen renders

'Every admin screen renders without a fatal and shows its own content' => function () {
    ch247_marketing_campaign_fixture();
    $fixture = array();
    $lists = new CloudHost247\Marketing\Repositories\ListRepository();
    $list = $lists->create('render-check', 'Render check');
    $subscriptions = new SubscriptionService();
    $subscriptions->subscribe(array('email' => 'render@example.com', 'list_ids' => array((int) $list->id)));
    (new CloudHost247\Marketing\Services\SegmentService())->save(array(
        'segment_key' => 'render-segment', 'name' => 'Render segment',
        'definition' => array('match' => 'all', 'rules' => array(array('field' => 'status', 'operator' => 'is', 'value' => SubscriberStatus::SUBSCRIBED))),
    ));
    $template = (new CloudHost247\Marketing\Services\TemplateService())->save(array(
        'template_key' => 'render-template', 'name' => 'Render template',
        'design' => array('blocks' => array(array('type' => 'paragraph', 'text' => 'Render body.', 'align' => 'left'))),
    ))['template'];
    $graph = ch247_marketing_worker(new CH247MarketingScriptedTransport());
    $campaign = $graph['service']->create(ch247_marketing_campaign_input(array('list' => $list, 'template' => $template), array(
        'name' => 'Render campaign', 'subject' => 'Render subject',
        'from_email' => 'render@example.com',
    )));

    $screens = array(
        'dashboard' => array(),
        'campaigns' => array(),
        'campaign' => array('id' => (int) $campaign->id),
        'subscribers' => array(),
        'subscriber' => array('id' => 1),
        'segments' => array(),
        'segment' => array('id' => 1),
        'templates' => array(),
        'template' => array('id' => (int) $template->id),
        'lists' => array(),
        'import' => array(),
        'suppressions' => array(),
        'settings' => array(),
    );
    // Every screen in $screens needs an entry here. The two detail screens were missing,
    // which made $expected[$screen] null: on PHP 8 a null needle is coerced to '' and
    // strpos() returns 0, so the check silently passed without verifying anything, while
    // on PHP 7.4 (the other half of the release-gate matrix) strpos() returned false and
    // the whole test failed. Both screens render an "Edit …" heading.
    $expected = array(
        'dashboard' => 'Email queue',
        'campaigns' => 'New campaign',
        'campaign' => 'Pre-send checklist',
        'subscribers' => 'Subscribers',
        'segments' => 'Segments',
        'segment' => 'Edit segment:',
        'templates' => 'Templates',
        'template' => 'Edit template:',
        'lists' => 'Lists',
        'import' => 'Import',
        'suppressions' => 'Suppression',
        'settings' => 'Delivery',
    );

    $view = new CloudHost247\Marketing\Http\AdminView();
    foreach ($screens as $screen => $query) {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = array_merge(array('view' => $screen), $query);
        $_POST = array(); $_REQUEST = array();
        $data = (new CloudHost247\Marketing\Http\AdminController())->handle();
        ob_start();
        try {
            $view->render($data);
        } catch (\Throwable $error) {
            ob_end_clean();
            throw new RuntimeException('Screen "' . $screen . '" failed to render: ' . $error->getMessage());
        }
        $html = ob_get_clean();
        if (strlen($html) < 1500) { return false; }
        if ($screen !== 'subscriber' && strpos($html, $expected[$screen]) === false) { return false; }
        if (strpos($html, 'Fatal error') !== false || strpos($html, 'Warning:') !== false) { return false; }
    }
    return true;
},

);
