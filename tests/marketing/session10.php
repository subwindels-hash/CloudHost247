<?php
/**
 * CloudHost247 Marketing — SESSION 10 behavior suite.
 *
 * Automation: authoring and activation, one live journey per subscriber, the
 * wait/send engine, delivery through the campaign queue, and the three ways a
 * journey stops (unsubscribe, suppression, archive).
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\AutomationRunStatus;
use CloudHost247\Marketing\Domain\AutomationStatus;
use CloudHost247\Marketing\Repositories\AutomationRepository;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Services\AutomationService;
use CloudHost247\Marketing\Services\CampaignService;
use CloudHost247\Marketing\Services\QueueService;
use CloudHost247\Marketing\Services\SubscriptionService;

/**
 * One automation service graph, sharing the campaign fixture (list + template +
 * a subscribed address + the public tracking URL).
 */
function ch247_marketing_automation_graph($transport = null, array $settings = array())
{
    $fixture = ch247_marketing_campaign_fixture();
    $transport = $transport ?: new CH247MarketingScriptedTransport();
    $settingsRepository = new SettingsRepository();
    foreach ($settings as $key => $value) { $settingsRepository->set($key, $value); }
    $campaignService = new CampaignService(null, null, null, null, null, $transport);
    $automations = new AutomationService(null, null, null, null, $settingsRepository);
    $worker = new QueueService(null, $campaignService, null, null, null, null, null, $settingsRepository, $automations);
    return array(
        'fixture' => $fixture, 'transport' => $transport, 'automations' => $automations,
        'worker' => $worker, 'settings' => $settingsRepository, 'service' => $campaignService,
    );
}

/** A one-step (send) automation, activated. */
function ch247_marketing_automation_ready($graph, array $overrides = array())
{
    $automations = $graph['automations'];
    $automation = $automations->create(array_merge(array(
        'name' => 'Welcome journey',
        'description' => 'A hello, then the library.',
        'trigger_type' => 'manual',
    ), $overrides));
    $automations->addStep((int) $automation->id, array(
        'step_type' => 'send_email',
        'template_id' => (int) $graph['fixture']['template']->id,
        'subject' => 'Welcome aboard',
    ));
    return $automations->activate((int) $automation->id);
}

function ch247_marketing_automation_rows()
{
    return ch247_mkt_rows('mod_cloudhost247_marketing_automations');
}

function ch247_marketing_run_rows()
{
    return ch247_mkt_rows('mod_cloudhost247_marketing_automation_runs');
}

return array(

// ---------------------------------------------------------------- authoring

'An automation is authored, validated before activation, and its container hides from the campaign list' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];

    $automation = $automations->create(array('name' => 'Welcome journey', 'trigger_type' => 'manual'));
    if ((string) $automation->status !== AutomationStatus::DRAFT) { return false; }

    // No steps yet: activation is refused with a reason a person can act on.
    $issues = $automations->activationIssues($automation);
    if (!in_array('Add at least one step.', $issues, true)) { return false; }
    try { $automations->activate((int) $automation->id); return false; }
    catch (RuntimeException $error) {
        if (strpos($error->getMessage(), 'Add at least one step.') === false) { return false; }
    }

    // A wait-only journey is refused too: it would never send anything.
    $automations->addStep((int) $automation->id, array('step_type' => 'wait', 'wait_minutes' => 60));
    if (!in_array('Add at least one send-email step.', $automations->activationIssues($automation), true)) { return false; }

    // A send step pointed at a missing template is refused.
    try { $automations->addStep((int) $automation->id, array('step_type' => 'send_email', 'template_id' => 999999, 'subject' => 'Hi')); return false; }
    catch (InvalidArgumentException $error) { /* expected */ }

    $automations->addStep((int) $automation->id, array(
        'step_type' => 'send_email', 'template_id' => (int) $graph['fixture']['template']->id, 'subject' => 'Welcome aboard',
    ));
    $active = $automations->activate((int) $automation->id);
    if ((string) $active->status !== AutomationStatus::ACTIVE || (int) $active->campaign_id <= 0) { return false; }

    // The container campaign exists, carries origin=automation, and is not
    // something the Campaigns screen shows or the worker thinks is due.
    $container = (new CampaignRepository())->find((int) $active->campaign_id);
    if (!$container || (string) $container->origin !== CampaignRepository::ORIGIN_AUTOMATION) { return false; }
    if ((string) $container->status !== 'sending') { return false; }
    $list = (new CampaignRepository())->paginate(array(), 1, 50);
    foreach ($list['rows'] as $row) { if ((int) $row->id === (int) $container->id) { return false; } }
    foreach ((new CampaignRepository())->due(date('Y-m-d H:i:s'), 10) as $due) { if ((int) $due->id === (int) $container->id) { return false; } }

    // Activation is audited like every other state change.
    $actions = ch247_marketing_audit_actions();
    return in_array('automation.created', $actions, true) && in_array('automation.activated', $actions, true)
        && in_array('automation.step_added', $actions, true);
},

'Removing a step renumbers the journey so the order stays gap-free' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $automation = $automations->create(array('name' => 'Three steps', 'trigger_type' => 'manual'));
    $templateId = (int) $graph['fixture']['template']->id;
    $automations->addStep((int) $automation->id, array('step_type' => 'send_email', 'template_id' => $templateId, 'subject' => 'One'));
    $middle = $automations->addStep((int) $automation->id, array('step_type' => 'wait', 'wait_minutes' => 1440));
    $automations->addStep((int) $automation->id, array('step_type' => 'send_email', 'template_id' => $templateId, 'subject' => 'Two'));

    $automations->removeStep((int) $automation->id, (int) $middle->id);
    $positions = array();
    foreach ($automations->stepsWithTemplates((int) $automation->id) as $entry) { $positions[] = (int) $entry['step']->position; }
    if ($positions !== array(1, 2)) { return false; }
    // Removing a step from another automation is refused, not silently ignored.
    try { $automations->removeStep((int) $automation->id, 987654); return false; }
    catch (InvalidArgumentException $error) { return true; }
},

// ---------------------------------------------------------------- enrolment

'One live journey per subscriber, and re-enrolment only when the operator allowed it' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $automation = ch247_marketing_automation_ready($graph);
    $subscriber = (new CloudHost247\Marketing\Repositories\SubscriberRepository())->findByEmail('reader@example.com');

    $first = $automations->enroll((int) $automation->id, (int) $subscriber->id);
    if (empty($first['ok']) || empty($first['created'])) { return false; }
    $again = $automations->enroll((int) $automation->id, (int) $subscriber->id);
    if (empty($again['ok']) || !empty($again['created']) || $again['reason'] !== 'already_enrolled') { return false; }
    if (count(ch247_marketing_run_rows()) !== 1) { return false; }

    // Finish the journey: the non-reenrollable automation still refuses.
    $automations->tick(10); // sends step 1
    $automations->tick(10); // finds no step after it and completes
    $run = ch247_marketing_run_rows()[0];
    if ((string) $run->status !== AutomationRunStatus::COMPLETED) { return false; }
    $after = $automations->enroll((int) $automation->id, (int) $subscriber->id);
    if (!empty($after['created']) || count(ch247_marketing_run_rows()) !== 1) { return false; }

    // The re-enrollable one starts a fresh run, keeping the finished one.
    $repeatable = $automations->create(array('name' => 'Repeatable', 'trigger_type' => 'manual', 'reenrollable' => 1));
    $automations->addStep((int) $repeatable->id, array(
        'step_type' => 'send_email', 'template_id' => (int) $graph['fixture']['template']->id, 'subject' => 'Again',
    ));
    $automations->activate((int) $repeatable->id);
    $one = $automations->enroll((int) $repeatable->id, (int) $subscriber->id);
    if (empty($one['created'])) { return false; }
    $automations->tick(10);
    $automations->tick(10);
    $two = $automations->enroll((int) $repeatable->id, (int) $subscriber->id);
    if (empty($two['created']) || (int) $two['run']->id === (int) $one['run']->id) { return false; }

    // A running journey is never duplicated, even on a repeatable automation.
    $three = $automations->enroll((int) $repeatable->id, (int) $subscriber->id);
    return empty($three['created']) && $three['reason'] === 'already_enrolled';
},

'An address that left, bounced or was suppressed is refused at enrolment' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $subscriptions = new SubscriptionService();
    $subscribers = new CloudHost247\Marketing\Repositories\SubscriberRepository();

    $automation = ch247_marketing_automation_ready($graph);
    $subscriptions->subscribe(array('email' => 'quiet@example.com'));
    $quiet = $subscribers->findByEmail('quiet@example.com');
    $subscriptions->unsubscribe('quiet@example.com');
    $result = $automations->enroll((int) $automation->id, (int) $quiet->id);
    if (!empty($result['ok']) || $result['reason'] !== 'unsubscribed') { return false; }

    $subscriptions->subscribe(array('email' => 'pending@example.com', 'status' => 'pending'));
    $pending = $subscribers->findByEmail('pending@example.com');
    $result = $automations->enroll((int) $automation->id, (int) $pending->id);
    if (!empty($result['ok']) || $result['reason'] !== 'not_subscribed') { return false; }

    $subscriptions->subscribe(array('email' => 'blocked@example.com'));
    $subscriptions->suppress('blocked@example.com', CloudHost247\Marketing\Domain\SuppressionReason::ADMIN_SUPPRESSED);
    $blocked = $subscribers->findByEmail('blocked@example.com');
    $result = $automations->enroll((int) $automation->id, (int) $blocked->id);
    if (!empty($result['ok'])) { return false; }
    return in_array($result['reason'], array('suppressed', 'not_subscribed'), true);
},

// ------------------------------------------------------------------- engine

'One tick sends one step: a send step queues a message and a wait step schedules the next' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $automation = $automations->create(array('name' => 'Welcome then wait', 'trigger_type' => 'manual'));
    $templateId = (int) $graph['fixture']['template']->id;
    $automations->addStep((int) $automation->id, array('step_type' => 'send_email', 'template_id' => $templateId, 'subject' => 'Welcome aboard'));
    $automations->addStep((int) $automation->id, array('step_type' => 'wait', 'wait_minutes' => 60));
    $automations->addStep((int) $automation->id, array('step_type' => 'send_email', 'template_id' => $templateId, 'subject' => 'Still with us?'));
    $automation = $automations->activate((int) $automation->id);
    $subscriber = (new CloudHost247\Marketing\Repositories\SubscriberRepository())->findByEmail('reader@example.com');
    $automations->enroll((int) $automation->id, (int) $subscriber->id);

    $first = $automations->tick(10);
    if ((int) $first['messages'] !== 1 || (int) $first['processed'] !== 1) { return false; }

    $rows = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue');
    if (count($rows) !== 1) { return false; }
    if ((int) $rows[0]->automation_run_id <= 0 || (int) $rows[0]->automation_step_position !== 1) { return false; }
    if ((string) $rows[0]->campaign_id !== (string) $automation->campaign_id) { return false; }

    // One step per tick: the run now sits at the send step, due again immediately.
    $run = ch247_marketing_run_rows()[0];
    if ((string) $run->status !== AutomationRunStatus::RUNNING || (int) $run->position !== 1) { return false; }

    // The next tick reaches the wait step: it schedules itself, sends nothing.
    $second = $automations->tick(10);
    if ((int) $second['messages'] !== 0 || (int) $second['waited'] !== 1) { return false; }
    $waiting = ch247_marketing_run_rows()[0];
    if ((string) $waiting->status !== AutomationRunStatus::WAITING || (int) $waiting->position !== 2) { return false; }

    // Nothing is due yet: ticking again does nothing at all.
    $early = $automations->tick(10);
    if ((int) $early['processed'] !== 0 || count(ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')) !== 1) { return false; }

    // Bring the wait forward: the second message is queued exactly once...
    ch247_mkt_update_row('mod_cloudhost247_marketing_automation_runs', (int) $waiting->id, array('next_run_at' => date('Y-m-d H:i:s', time() - 60)));
    $third = $automations->tick(10);
    if ((int) $third['messages'] !== 1) { return false; }

    // ...and a final tick past the last step completes the run.
    $automations->tick(10);
    $finished = ch247_marketing_run_rows()[0];
    if ((string) $finished->status !== AutomationRunStatus::COMPLETED) { return false; }
    if ((int) $finished->sent_count !== 2) { return false; }
    return count(ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')) === 2;
},

'The worker delivers an automation message from the step\'s own template in the same pass' => function () {
    $graph = ch247_marketing_automation_graph();
    $automation = ch247_marketing_automation_ready($graph);
    $subscriber = (new CloudHost247\Marketing\Repositories\SubscriberRepository())->findByEmail('reader@example.com');
    $graph['automations']->enroll((int) $automation->id, (int) $subscriber->id);

    $summary = $graph['worker']->run(array('worker' => 'session10'));
    if ((int) $summary['automations']['messages'] !== 1) { return false; }
    if ((int) $summary['sent'] !== 1 || count($graph['transport']->sent) !== 1) { return false; }

    $message = $graph['transport']->sent[0];
    if ($message['to'] !== 'reader@example.com') { return false; }
    // The step's subject and template, not the container's empty content.
    if ($message['subject'] !== 'Welcome aboard') { return false; }
    if (strpos($message['html'], 'Body copy for the campaign.') === false) { return false; }
    // The footer is the compliance part of every real send: an unsubscribe link
    // in the HTML and the matching List-Unsubscribe header.
    if (stripos($message['html'], 'Unsubscribe</a>') === false) { return false; }
    if (strpos($message['headers']['List-Unsubscribe'], 'cloudhost247-marketing-track.php') === false) { return false; }
    // Attribution: the container campaign carries the event, and the ledger says sent.
    $events = ch247_mkt_rows('mod_cloudhost247_marketing_email_events');
    $sent = 0;
    foreach ($events as $event) {
        if ((string) $event->type === 'sent' && (int) $event->campaign_id === (int) $automation->campaign_id) { $sent++; }
    }
    return $sent === 1;
},

// ------------------------------------------------------------------- stopping

'Unsubscribing cancels a live journey before its queued message can go out' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $subscriptions = new SubscriptionService($graph['fixture'] ? null : null);
    $subscriptions = new SubscriptionService();

    // A list-triggered journey: joining the list is what starts it.
    $automation = $automations->create(array(
        'name' => 'Newsletter welcome', 'trigger_type' => 'list_joined', 'list_id' => (int) $graph['fixture']['list']->id,
    ));
    $automations->addStep((int) $automation->id, array(
        'step_type' => 'send_email', 'template_id' => (int) $graph['fixture']['template']->id, 'subject' => 'Hello new member',
    ));
    $automations->addStep((int) $automation->id, array(
        'step_type' => 'send_email', 'template_id' => (int) $graph['fixture']['template']->id, 'subject' => 'One more thing',
    ));
    $automations->activate((int) $automation->id);

    $joined = $subscriptions->subscribe(array('email' => 'joiner@example.com', 'list_ids' => array((int) $graph['fixture']['list']->id)));
    if ((int) $joined['automations_started'] !== 1) { return false; }
    $automations->tick(10); // first message queued
    if (count(ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')) !== 1) { return false; }

    // They unsubscribe while the message is still queued.
    $left = $subscriptions->unsubscribe('joiner@example.com');
    if ((int) $left['automations_cancelled'] !== 1) { return false; }
    $run = ch247_marketing_run_rows()[0];
    if ((string) $run->status !== AutomationRunStatus::CANCELLED) { return false; }

    // The delivery pass reaches the already-queued row and refuses it, and the
    // next tick advances nothing.
    $summary = $graph['worker']->run(array('worker' => 'session10'));
    if ((int) $summary['sent'] !== 0 || count($graph['transport']->sent) !== 0) { return false; }
    $queued = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')[0];
    if ((string) $queued->status !== 'skipped' || strpos((string) $queued->last_error, 'suppressed') === false) { return false; }
    $after = $automations->tick(10);
    return (int) $after['messages'] === 0 && count(ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')) === 1;
},

'A hard bounce and an admin suppression both stop a live journey' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $subscriptions = new SubscriptionService();
    $subscribers = new CloudHost247\Marketing\Repositories\SubscriberRepository();

    $automation = ch247_marketing_automation_ready($graph);
    $subscriptions->subscribe(array('email' => 'bouncer@example.com'));
    $bouncer = $subscribers->findByEmail('bouncer@example.com');
    $automations->enroll((int) $automation->id, (int) $bouncer->id);
    $subscriptions->recordBounce('bouncer@example.com', 'hard');
    $run = ch247_marketing_run_rows()[0];
    if ((string) $run->status !== AutomationRunStatus::CANCELLED) { return false; }

    $subscriptions->subscribe(array('email' => 'held@example.com'));
    $held = $subscribers->findByEmail('held@example.com');
    $automations->enroll((int) $automation->id, (int) $held->id);
    $subscriptions->suppress('held@example.com', CloudHost247\Marketing\Domain\SuppressionReason::ADMIN_SUPPRESSED);
    $runs = ch247_marketing_run_rows();
    $cancelled = 0;
    foreach ($runs as $row) { if ((string) $row->status === AutomationRunStatus::CANCELLED) { $cancelled++; } }
    return $cancelled === 2;
},

'Pausing holds live journeys where they are; archiving cancels them' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $automation = ch247_marketing_automation_ready($graph);
    $subscriber = (new CloudHost247\Marketing\Repositories\SubscriberRepository())->findByEmail('reader@example.com');
    $automations->enroll((int) $automation->id, (int) $subscriber->id);

    $automations->pause((int) $automation->id);
    $held = $automations->tick(10);
    if ((int) $held['held'] !== 1 || (int) $held['messages'] !== 0) { return false; }
    $run = ch247_marketing_run_rows()[0];
    if ((string) $run->status !== AutomationRunStatus::RUNNING) { return false; }
    if (count(ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')) !== 0) { return false; }

    // Resuming picks the journey up exactly where it stopped.
    $automations->activate((int) $automation->id);
    $resumed = $automations->tick(10);
    if ((int) $resumed['messages'] !== 1) { return false; }

    // Archiving cancels the live journey and keeps its history.
    $automations->archive((int) $automation->id);
    $runs = ch247_marketing_run_rows();
    if ((string) $runs[0]->status !== AutomationRunStatus::CANCELLED) { return false; }
    if (count($runs) !== 1) { return false; }
    $nothing = $automations->tick(10);
    return (int) $nothing['messages'] === 0;
},

'A queued automation message whose template was archived is skipped with a reason' => function () {
    $graph = ch247_marketing_automation_graph();
    $automation = ch247_marketing_automation_ready($graph);
    $subscriber = (new CloudHost247\Marketing\Repositories\SubscriberRepository())->findByEmail('reader@example.com');
    $graph['automations']->enroll((int) $automation->id, (int) $subscriber->id);
    $graph['automations']->tick(10);

    // The template is archived before the delivery pass reaches the message.
    (new CloudHost247\Marketing\Services\TemplateService())->archive((int) $graph['fixture']['template']->id);
    $summary = $graph['worker']->run(array('worker' => 'session10'));
    if ((int) $summary['sent'] !== 0) { return false; }

    $row = ch247_mkt_rows('mod_cloudhost247_marketing_email_queue')[0];
    if ((string) $row->status !== 'skipped') { return false; }
    if (strpos((string) $row->last_error, 'automation_content_missing') === false) { return false; }
    return in_array('automation.message_skipped', ch247_marketing_audit_actions(), true);
},

// ------------------------------------------------------------------ triggers

'A new subscriber starts the journeys whose trigger matches' => function () {
    $graph = ch247_marketing_automation_graph();
    $automations = $graph['automations'];
    $subscriptions = new SubscriptionService();

    $anyNew = $automations->create(array('name' => 'Any new subscriber', 'trigger_type' => 'subscriber_added'));
    $automations->addStep((int) $anyNew->id, array('step_type' => 'send_email', 'template_id' => (int) $graph['fixture']['template']->id, 'subject' => 'Hello'));
    $automations->activate((int) $anyNew->id);

    $thisList = $automations->create(array('name' => 'This list', 'trigger_type' => 'list_joined', 'list_id' => (int) $graph['fixture']['list']->id));
    $automations->addStep((int) $thisList->id, array('step_type' => 'send_email', 'template_id' => (int) $graph['fixture']['template']->id, 'subject' => 'Welcome to the list'));
    $automations->activate((int) $thisList->id);

    $joined = $subscriptions->subscribe(array('email' => 'fresh@example.com', 'list_ids' => array((int) $graph['fixture']['list']->id)));
    if ((int) $joined['automations_started'] !== 2) { return false; }

    // An update to an existing subscriber does not re-trigger subscriber_added...
    $again = $subscriptions->subscribe(array('email' => 'fresh@example.com'));
    if ((int) $again['automations_started'] !== 0) { return false; }
    if (count(ch247_marketing_run_rows()) !== 2) { return false; }
    // ...and the list trigger only fires for its own list.
    $other = $subscriptions->subscribe(array('email' => 'other@example.com'));
    if ((int) $other['automations_started'] !== 1) { return false; }
    return count(ch247_marketing_run_rows()) === 3;
},

// -------------------------------------------------------------------- screen

'The automations screen renders and every POST is CSRF- and capability-guarded' => function () {
    $graph = ch247_marketing_automation_graph();
    $automation = ch247_marketing_automation_ready($graph);

    // GET renders the list, the detail and the add-step forms without a fatal.
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'automations', 'automation_id' => (int) $automation->id);
    $_POST = array(); $_REQUEST = array();
    $data = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if ($data['view'] !== 'automations' || (int) $data['plannedSession'] !== 0) { return false; }
    if (empty($data['automationsView']['detail'])) { return false; }
    ob_start();
    try { (new CloudHost247\Marketing\Http\AdminView())->render($data); } catch (Throwable $error) { ob_end_clean(); throw $error; }
    $html = ob_get_clean();
    foreach (array('Automations', 'Welcome journey', 'Send email', 'Activate', 'Runs', 'steps run top to bottom') as $needle) {
        if (stripos($html, $needle) === false) { return false; }
    }
    if (strpos($html, 'Fatal error') !== false) { return false; }

    // A POST without the token is refused before it can touch anything.
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET = array('view' => 'automations');
    $_POST = array('action' => 'automation.pause', 'automation_id' => (int) $automation->id, 'token' => 'nope');
    $_REQUEST = $_POST;
    try {
        (new CloudHost247\Marketing\Http\AdminController())->handle();
    } catch (Throwable $error) {
        // Guard refusal is the expected path.
    }
    $fresh = ch247_marketing_automation_rows();
    if ((string) $fresh[0]->status !== AutomationStatus::ACTIVE) { return false; }

    // A manual enrolment through the admin form.
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = array(
        'action' => 'automation.enroll', 'automation_id' => (int) $automation->id,
        'email' => 'reader@example.com', 'token' => str_repeat('ab', 16),
    );
    $_REQUEST = $_POST;
    $data = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if (strpos((string) $data['notice'], 'enrolled') === false) { return false; }
    return count(ch247_marketing_run_rows()) === 1;
},

'Automation traffic is attributed to its container in analytics, and never as a campaign' => function () {
    $graph = ch247_marketing_automation_graph();
    $automation = ch247_marketing_automation_ready($graph);
    $subscriber = (new CloudHost247\Marketing\Repositories\SubscriberRepository())->findByEmail('reader@example.com');
    $graph['automations']->enroll((int) $automation->id, (int) $subscriber->id);
    $graph['worker']->run(array('worker' => 'session10'));

    $analytics = new CloudHost247\Marketing\Services\AnalyticsService();
    $summary = $analytics->campaignSummary((int) $automation->campaign_id);
    if (!$summary || (int) $summary['counts']['accepted'] !== 1) { return false; }
    if (strpos((string) $summary['campaign']->name, 'Automation:') !== 0) { return false; }

    // The container does not appear in the campaign list, so an operator cannot
    // accidentally schedule it, but the reporting on it is real.
    $rows = (new CampaignRepository())->paginate(array(), 1, 50)['rows'];
    foreach ($rows as $row) { if ((int) $row->id === (int) $automation->campaign_id) { return false; } }
    return true;
},

'The automation source never writes to a WHMCS core table and never sends directly' => function () {
    $root = dirname(dirname(__DIR__)) . '/modules/addons/cloudhost247_marketing/lib';
    $service = file_get_contents($root . '/Services/AutomationService.php');
    foreach (array("Capsule::table('tbl", 'tblclients', '->send(') as $forbidden) {
        if (strpos($service, $forbidden) !== false) { return false; }
    }
    // `email(` inside `InputValidator::email(` is not a mailer; only a bare call is.
    if (preg_match('/(?<![A-Za-z_])mail\s*\(/', $service)) { return false; }
    // Delivery is the queue's job: the service enqueues and nothing else.
    if (strpos($service, '->enqueue(') === false) { return false; }
    $views = file_get_contents($root . '/Http/AdminView.php');
    return strpos($views, 'automationsView') !== false;
},

);
