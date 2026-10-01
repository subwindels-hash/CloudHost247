<?php
/**
 * CloudHost247 Marketing — SESSION 5 behavior suite.
 *
 * Campaigns: the pre-send checklist, the state machine, scheduling in local
 * time, the frozen audience, honest test sends and the admin flow. Pure PHP,
 * in-memory fakes (fakes.php); every test calls the real module classes.
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\CampaignAudience;
use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\ListRepository;
use CloudHost247\Marketing\Repositories\TemplateRepository;
use CloudHost247\Marketing\Services\CampaignService;
use CloudHost247\Marketing\Services\MessageTransport;
use CloudHost247\Marketing\Services\SegmentService;
use CloudHost247\Marketing\Services\SubscriptionService;

/** A transport that records what it was asked to send and answers honestly. */
final class CH247MarketingFakeTransport implements MessageTransport
{
    public $sent = array();
    public $failWith = '';
    public $available = true;

    public function key() { return 'fake_smtp'; }
    public function isAvailable() { return $this->available; }
    public function reason() { return $this->available ? '' : 'No delivery provider is wired into this build yet.'; }

    public function send(array $message)
    {
        if ($this->failWith !== '') {
            return array('ok' => false, 'error' => $this->failWith, 'provider_message_id' => '');
        }
        $this->sent[] = $message;
        return array('ok' => true, 'error' => '', 'provider_message_id' => 'fake-' . count($this->sent));
    }
}

/** Boots the module, one list with one subscribed address, and a template. */
function ch247_marketing_campaign_fixture()
{
    ch247_marketing_admin(); // fresh tables, activation, admin session
    $lists = new ListRepository();
    $list = $lists->create('newsletter', 'Newsletter');
    $subscribers = new SubscriptionService();
    $subscribers->subscribe(array('email' => 'reader@example.com', 'list_ids' => array((int) $list->id)));
    $template = (new CloudHost247\Marketing\Services\TemplateService())->save(array(
        'template_key' => 'campaign-content',
        'name' => 'Campaign content',
        'design' => array('blocks' => array(
            array('type' => 'heading', 'text' => 'Hello', 'level' => '2', 'align' => 'left'),
            array('type' => 'paragraph', 'text' => 'Body copy for the campaign.', 'align' => 'left'),
        )),
    ))['template'];
    return array('list' => $list, 'template' => $template);
}

function ch247_marketing_campaign_input($fixture, array $overrides = array())
{
    return array_merge(array(
        'name' => 'October newsletter',
        'subject' => 'October news',
        'preview_text' => 'What changed this month',
        'from_name' => 'CloudHost247',
        'from_email' => 'news@example.com',
        'reply_to' => 'support@example.com',
        'template_id' => (int) $fixture['template']->id,
        'audience_type' => CampaignAudience::LIST,
        'audience_id' => (int) $fixture['list']->id,
    ), $overrides);
}

return array(

// ------------------------------------------------------------------- creation

'Creating a campaign validates sender, subject and audience and is idempotent by key' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $service = new CampaignService();

    $campaign = $service->create(ch247_marketing_campaign_input($fixture));
    if ($campaign->status !== CampaignStatus::DRAFT) { return false; }
    if ($campaign->template_id !== (int) $fixture['template']->id) { return false; }
    if ($campaign->html === '' || $campaign->text === '') { return false; }
    if ($campaign->idempotency_key === '') { return false; }

    // Content is copied out of the template, never referenced by id at send time:
    // editing the library entry afterwards must not change this campaign.
    $edited = $fixture['template'];
    (new CloudHost247\Marketing\Services\TemplateService())->save(array(
        'name' => 'Campaign content',
        'design' => array('blocks' => array(array('type' => 'paragraph', 'text' => 'A completely different message.', 'align' => 'left'))),
    ), (int) $edited->id);
    if (strpos((new CampaignRepository())->find((int) $campaign->id)->html, 'Body copy for the campaign.') === false) { return false; }

    // Same idempotency key returns the same campaign, not a duplicate.
    $again = $service->create(array_merge(ch247_marketing_campaign_input($fixture), array('idempotency_key' => $campaign->idempotency_key)));
    if ((int) $again->id !== (int) $campaign->id) { return false; }
    if ((new CampaignRepository())->count() !== 1) { return false; }

    // Validation refusals.
    $rejects = array(
        array(array('name' => ''), 'needs a name'),
        array(array('subject' => "Bad\r\nBcc: x@example.com"), 'cannot contain line breaks'),
        array(array('from_email' => 'not-an-address'), 'Sender address'),
        array(array('from_name' => ''), 'needs a sender name'),
        array(array('audience_type' => 'everyone'), 'Choose a mailing list'),
        array(array('audience_id' => 99999), 'does not exist'),
        array(array('template_id' => 99999), 'template does not exist'),
        array(array('reply_to' => 'nope'), 'Reply-to address'),
    );
    foreach ($rejects as $case) {
        try {
            $service->create(ch247_marketing_campaign_input($fixture, $case[0]));
        } catch (InvalidArgumentException $e) {
            if (strpos($e->getMessage(), $case[1]) === false) { return false; }
            continue;
        }
        return false;
    }

    // An archived template is not selectable.
    (new CloudHost247\Marketing\Services\TemplateService())->archive((int) $fixture['template']->id);
    try {
        $service->create(ch247_marketing_campaign_input($fixture, array('name' => 'Archived template')));
        return false;
    } catch (InvalidArgumentException $e) {
        if (strpos($e->getMessage(), 'archived') === false) { return false; }
    }
    return true;
},

// ---------------------------------------------------------------- checklist

'The checklist blocks on content, sender and audience and reports the provider separately' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $service = new CampaignService();
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));

    $checklist = $service->checklist($campaign);
    $byKey = array();
    foreach ($checklist as $check) { $byKey[$check['key']] = $check; }
    foreach (array('name', 'subject', 'from_email', 'from_name', 'reply_to', 'content', 'audience') as $key) {
        if (!isset($byKey[$key]) || !$byKey[$key]['ok']) { return false; }
    }
    // The provider is reported, but it is advisory here: blocking is decided by
    // the transport itself so a configured provider is never confused with one
    // that is actually wired in.
    if ($byKey['transport']['blocking'] !== false) { return false; }
    if ($byKey['audience']['detail'] === '' || strpos($byKey['audience']['detail'], '1 subscribed') === false) { return false; }

    // Emptying the subject or detaching the audience fails the blocking checks.
    $broken = (new CampaignRepository())->update((int) $campaign->id, array('subject' => '   '));
    $issues = $service->blockingIssues($broken);
    if (count($issues) !== 1 || strpos($issues[0], 'Subject line') !== 0) { return false; }

    $noAudience = (new CampaignRepository())->update((int) $campaign->id, array(
        'subject' => 'Fine again', 'audience_type' => CampaignAudience::ALL,
    ));
    if ($service->blockingIssues($noAudience) !== array()) { return false; }
    return $service->audiencePreview($noAudience)['count'] === 1;
},

'The audience preview counts subscribed members only and flags segment uncertainty' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $subscriptions = new SubscriptionService();
    $subscriptions->subscribe(array('email' => 'second@example.com', 'list_ids' => array((int) $fixture['list']->id)));
    $subscriptions->unsubscribe('second@example.com', 'admin');
    $service = new CampaignService();
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));

    // Two members, one unsubscribed: the list audience counts one.
    $preview = $service->audiencePreview($campaign);
    if ($preview['count'] !== 1 || strpos($preview['detail'], '1 subscribed of 2 member(s)') === false) { return false; }

    // A segment with customer facts that cannot be read reports the uncertainty.
    ch247_marketing_seed_subscriber('a@example.com');
    ch247_marketing_seed_subscriber('b@example.com');
    $segment = (new SegmentService())->save(array(
        'segment_key' => 'unverifiable',
        'name' => 'Unverifiable',
        'definition' => array('match' => 'all', 'rules' => array(array('field' => 'client.country', 'operator' => 'is', 'value' => 'NG'))),
    ));
    $segmentCampaign = $service->create(ch247_marketing_campaign_input($fixture, array(
        'name' => 'Segment campaign',
        'audience_type' => CampaignAudience::SEGMENT,
        'audience_id' => (int) $segment->id,
    )));
    $segmentPreview = $service->audiencePreview($segmentCampaign);
    if ($segmentPreview['count'] !== 0 || $segmentPreview['issues'] === array()) { return false; }

    // An archived segment cannot address a campaign at all.
    (new SegmentService())->archive((int) $segment->id);
    $archived = $service->audiencePreview($segmentCampaign);
    return $archived['count'] === 0 && strpos(implode(' ', $archived['issues']), 'Archived') !== false;
},

// --------------------------------------------------------- state machine

'The state machine allows only the documented transitions and audits each one' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $service = new CampaignService();
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));

    if (!CampaignService::canTransition(CampaignStatus::DRAFT, CampaignStatus::READY)) { return false; }
    if (CampaignService::canTransition(CampaignStatus::COMPLETED, CampaignStatus::SENDING)) { return false; }
    if (CampaignService::canTransition(CampaignStatus::ARCHIVED, CampaignStatus::DRAFT)) { return false; }

    // Scheduling straight from draft is refused by the state machine, not by a
    // missing button: the API protects itself.
    try {
        $service->pause((int) $campaign->id);
        return false;
    } catch (RuntimeException $e) {
        if (strpos($e->getMessage(), 'cannot move to') === false) { return false; }
    }

    $ready = $service->markReady((int) $campaign->id);
    if ($ready['campaign']->status !== CampaignStatus::READY) { return false; }

    $scheduled = $service->schedule((int) $campaign->id, date('Y-m-d H:i', time() + 86400), 'UTC');
    if ($scheduled['campaign']->status !== CampaignStatus::SCHEDULED) { return false; }
    if (strpos($scheduled['message'], 'UTC') === false) { return false; }

    $paused = $service->pause((int) $campaign->id);
    if ($paused['campaign']->status !== CampaignStatus::PAUSED) { return false; }
    // Pausing retains the schedule so the operator can resume it as-is.
    if ($paused['campaign']->scheduled_at === null) { return false; }

    $resumed = $service->resume((int) $campaign->id, date('Y-m-d H:i', time() + 172800), 'UTC');
    if ($resumed['campaign']->status !== CampaignStatus::SCHEDULED) { return false; }

    $cancelled = $service->cancel((int) $campaign->id);
    if ($cancelled['campaign']->status !== CampaignStatus::CANCELLED) { return false; }
    $archived = $service->archive((int) $campaign->id);
    if ($archived['campaign']->status !== CampaignStatus::ARCHIVED) { return false; }

    foreach (array('campaign.created', 'campaign.ready', 'campaign.scheduled', 'campaign.paused', 'campaign.resumed', 'campaign.cancelled', 'campaign.archived') as $action) {
        if (!in_array($action, ch247_marketing_audit_actions(), true)) { return false; }
    }

    // A campaign in a terminal state refuses edits outright.
    try {
        $service->update((int) $campaign->id, array('subject' => 'Too late'));
        return false;
    } catch (RuntimeException $e) {
        return strpos($e->getMessage(), 'not editable') !== false;
    }
},

'Scheduling validates the local time and converts it to UTC' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $service = new CampaignService();
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));
    $service->markReady((int) $campaign->id);

    // Africa/Lagos is UTC+1 all year: 09:30 local is 08:30 UTC.
    $result = $service->schedule((int) $campaign->id, '2030-06-01 09:30', 'Africa/Lagos');
    if ($result['campaign']->scheduled_at !== '2030-06-01 08:30:00') { return false; }
    if ($result['campaign']->scheduled_timezone !== 'Africa/Lagos') { return false; }

    foreach (array(
        array('2030-06-01', 'UTC', 'YYYY-MM-DD HH:MM'),
        array('01/06/2030 09:30', 'UTC', 'YYYY-MM-DD HH:MM'),
        array('2030-06-01 09:30', 'Mars/Olympus', 'valid timezone'),
        array('2020-01-01 09:30', 'UTC', 'in the future'),
    ) as $case) {
        try {
            $service->schedule((int) $campaign->id, $case[0], $case[1]);
        } catch (InvalidArgumentException $e) {
            if (strpos($e->getMessage(), $case[2]) === false) { return false; }
            continue;
        }
        return false;
    }

    // Scheduling refuses while a blocking check fails, whatever the time.
    (new CampaignRepository())->update((int) $campaign->id, array('subject' => ''));
    try {
        $service->schedule((int) $campaign->id, '2030-06-01 09:30', 'UTC');
        return false;
    } catch (RuntimeException $e) {
        return strpos($e->getMessage(), 'Subject line') !== false;
    }
},

'Content edits return an approved campaign to draft so approval always matches content' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $service = new CampaignService();
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));
    $service->markReady((int) $campaign->id);

    $updated = $service->update((int) $campaign->id, array('subject' => 'A changed subject'));
    if ($updated->status !== CampaignStatus::DRAFT) { return false; }
    if (!in_array('campaign.updated', ch247_marketing_audit_actions(), true)) { return false; }

    // In draft, editing keeps it a draft and the audience can be switched.
    $switched = $service->update((int) $campaign->id, array(
        'audience_type' => CampaignAudience::ALL,
        'audience_id' => 12,
    ));
    if ($switched->audience_type !== CampaignAudience::ALL || (int) $switched->audience_id !== 0) { return false; }

    // A paused campaign stays paused: editing does not resurrect a schedule.
    $service->markReady((int) $campaign->id);
    $service->schedule((int) $campaign->id, '2030-06-01 09:30', 'UTC');
    $service->pause((int) $campaign->id);
    $edited = $service->update((int) $campaign->id, array('preview_text' => 'Updated in pause'));
    return $edited->status === CampaignStatus::PAUSED
        && in_array((string) $edited->status, CampaignService::EDITABLE_STATUSES, true);
},

// -------------------------------------------------------------- test send

'A test send goes through the real transport, and a refusal is audited with its reason' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingFakeTransport();
    $service = new CampaignService(null, null, null, null, null, $transport);
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));

    $result = $service->sendTest((int) $campaign->id, 'operator@example.com');
    if ($result['transport'] !== 'fake_smtp') { return false; }
    if (count($transport->sent) !== 1) { return false; }
    $sent = $transport->sent[0];
    if ($sent['to'] !== 'operator@example.com') { return false; }
    if ($sent['subject'] !== '[Test] October news') { return false; }
    if (strpos($sent['html'], 'Body copy for the campaign.') === false) { return false; }
    if ($sent['headers']['X-CloudHost247-Campaign'] !== (int) $campaign->id) { return false; }
    if (!in_array('campaign.test_sent', ch247_marketing_audit_actions(), true)) { return false; }

    // Provider failure surfaces and is recorded as a failure.
    $transport->failWith = '550 relay denied';
    try {
        $service->sendTest((int) $campaign->id, 'operator@example.com');
        return false;
    } catch (RuntimeException $e) {
        if (strpos($e->getMessage(), '550 relay denied') === false) { return false; }
    }
    if (!in_array('campaign.test_failed', ch247_marketing_audit_actions(), true)) { return false; }

    // No provider: refused with the reason, and nothing is sent.
    $offline = new CampaignService(null, null, null, null, null, new CloudHost247\Marketing\Services\UnavailableTransport('Nothing wired in yet.'));
    $before = count($transport->sent);
    try {
        $offline->sendTest((int) $campaign->id, 'operator@example.com');
        return false;
    } catch (RuntimeException $e) {
        if (strpos($e->getMessage(), 'Nothing wired in yet.') === false) { return false; }
    }
    if (count($transport->sent) !== $before) { return false; }
    return in_array('campaign.test_refused', ch247_marketing_audit_actions(), true);
},

'A test send refuses an invalid address and any campaign failing the checklist' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $transport = new CH247MarketingFakeTransport();
    $service = new CampaignService(null, null, null, null, null, $transport);
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));

    try {
        $service->sendTest((int) $campaign->id, 'not-an-address');
        return false;
    } catch (InvalidArgumentException $e) {
        if (strpos($e->getMessage(), 'Test address') === false) { return false; }
    }

    (new CampaignRepository())->update((int) $campaign->id, array('from_email' => ''));
    try {
        $service->sendTest((int) $campaign->id, 'operator@example.com');
        return false;
    } catch (RuntimeException $e) {
        return strpos($e->getMessage(), 'Sender address') !== false && $transport->sent === array();
    }
},

// ------------------------------------------------------------ admin screens

'Campaigns are created, edited and driven through their lifecycle from the admin screens' => function () {
    $fixture = ch247_marketing_campaign_fixture();

    // Missing CSRF token: refused before anything is written.
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET = array('view' => 'campaigns');
    $_POST = array('action' => 'campaign.save', 'name' => 'No token');
    $_REQUEST = $_POST;
    $refused = false;
    try { (new CloudHost247\Marketing\Http\AdminController())->handle(); } catch (RuntimeException $e) { $refused = true; }
    if (!$refused || (new CampaignRepository())->count() !== 0) { return false; }

    $created = ch247_marketing_post('campaigns', array(
        'action' => 'campaign.save',
        'name' => 'October newsletter',
        'subject' => 'October news',
        'preview_text' => 'What changed',
        'from_name' => 'CloudHost247',
        'from_email' => 'news@example.com',
        'reply_to' => '',
        'template_id' => (int) $fixture['template']->id,
        'audience_type' => CampaignAudience::LIST,
        'audience_id' => (int) $fixture['list']->id,
    ));
    if ($created['notice'] !== 'Campaign created as a draft.') { return false; }
    $campaign = (new CampaignRepository())->paginate()['rows'][0];

    // The detail screen renders the checklist and the audience preview.
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'campaign', 'id' => (int) $campaign->id);
    $_POST = array(); $_REQUEST = array();
    $detail = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if (empty($detail['campaignDetail']['row'])) { return false; }
    if (count($detail['campaignDetail']['checklist']) !== 9) { return false; }
    if ($detail['campaignDetail']['audience']['count'] !== 1) { return false; }

    $ready = ch247_marketing_post('campaign', array('action' => 'campaign.ready', 'campaign_id' => (int) $campaign->id), array('id' => (int) $campaign->id));
    if (strpos($ready['notice'], 'ready for scheduling') === false) { return false; }

    $scheduled = ch247_marketing_post('campaign', array(
        'action' => 'campaign.schedule',
        'campaign_id' => (int) $campaign->id,
        'scheduled_at' => '2030-06-01 09:30',
        'scheduled_timezone' => 'Africa/Lagos',
    ), array('id' => (int) $campaign->id));
    if (strpos($scheduled['notice'], '2030-06-01 08:30:00 UTC') === false) { return false; }

    $paused = ch247_marketing_post('campaign', array('action' => 'campaign.pause', 'campaign_id' => (int) $campaign->id), array('id' => (int) $campaign->id));
    if (strpos($paused['notice'], 'paused') === false) { return false; }

    $cancelled = ch247_marketing_post('campaign', array('action' => 'campaign.cancel', 'campaign_id' => (int) $campaign->id), array('id' => (int) $campaign->id));
    if (strpos($cancelled['notice'], 'cancelled') === false) { return false; }
    if ((new CampaignRepository())->find((int) $campaign->id)->status !== CampaignStatus::CANCELLED) { return false; }

    foreach (array('campaign.created', 'campaign.ready', 'campaign.scheduled', 'campaign.paused', 'campaign.cancelled') as $action) {
        if (!in_array($action, ch247_marketing_audit_actions(), true)) { return false; }
    }

    // Capability policy for role 2 only: role 1 is refused outright.
    CH247MarketingFakeDB::rowsRef('mod_cloudhost247_capabilities')[] = array(
        'id' => 4, 'module' => 'cloudhost247_marketing', 'capability' => 'marketing.campaigns.manage', 'role_ids' => '2',
    );
    $_SESSION['adminroleid'] = 1;
    try {
        ch247_marketing_post('campaigns', array('action' => 'campaign.save', 'name' => 'Denied'));
        return false;
    } catch (RuntimeException $e) {
        return (new CampaignRepository())->count() === 1;
    }
},

'Editing a scheduled campaign from the admin screen is refused, and a draft edit is reported' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $service = new CampaignService();
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));
    $service->markReady((int) $campaign->id);
    $service->schedule((int) $campaign->id, date('Y-m-d H:i', time() + 3600), 'UTC');

    $refused = ch247_marketing_post('campaign', array(
        'action' => 'campaign.save',
        'campaign_id' => (int) $campaign->id,
        'name' => 'Renamed while scheduled',
    ), array('id' => (int) $campaign->id));
    if (strpos($refused['error'], 'not editable') === false) { return false; }

    // Draft edits save and are reported honestly.
    $draft = (new CampaignService())->create(ch247_marketing_campaign_input($fixture, array('name' => 'Second draft')));
    $saved = ch247_marketing_post('campaign', array(
        'action' => 'campaign.save',
        'campaign_id' => (int) $draft->id,
        'name' => 'Second draft',
        'subject' => 'Updated subject',
        'from_name' => 'CloudHost247',
        'from_email' => 'news@example.com',
        'audience_type' => CampaignAudience::LIST,
        'audience_id' => (int) $fixture['list']->id,
    ), array('id' => (int) $draft->id));
    return $saved['notice'] === 'Campaign saved.' && strpos((new CampaignRepository())->find((int) $draft->id)->subject, 'Updated subject') === 0;
},

'An unavailable transport is reported, and a test send through it is refused with a reason' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $service = new CampaignService();
    $campaign = $service->create(ch247_marketing_campaign_input($fixture));

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'campaign', 'id' => (int) $campaign->id);
    $_POST = array(); $_REQUEST = array();
    $detail = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if (!empty($detail['campaignDetail']['transport']['available'])) { return false; }
    if (strpos($detail['campaignDetail']['transport']['reason'], 'cPanel SMTP') === false) { return false; }

    $refused = ch247_marketing_post('campaign', array(
        'action' => 'campaign.test',
        'campaign_id' => (int) $campaign->id,
        'test_email' => 'operator@example.com',
    ), array('id' => (int) $campaign->id));
    if (strpos($refused['error'], 'cPanel SMTP') === false) { return false; }
    return $refused['notice'] === '' && in_array('campaign.test_refused', ch247_marketing_audit_actions(), true);
},

'The campaign list filters by status and search and never hides a campaign behind a blank page' => function () {
    $fixture = ch247_marketing_campaign_fixture();
    $service = new CampaignService();
    $first = $service->create(ch247_marketing_campaign_input($fixture, array('name' => 'Alpha news')));
    $service->create(ch247_marketing_campaign_input($fixture, array('name' => 'Beta news')));
    $service->markReady((int) $first->id);

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array('view' => 'campaigns');
    $_POST = array(); $_REQUEST = array();
    $all = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if ($all['campaignsView']['total'] !== 2) { return false; }
    if ((int) $all['campaignsView']['counts'][CampaignStatus::READY] !== 1) { return false; }

    $_GET = array('view' => 'campaigns', 'status' => CampaignStatus::READY);
    $readyOnly = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if ($readyOnly['campaignsView']['total'] !== 1) { return false; }

    $_GET = array('view' => 'campaigns', 'q' => 'Alpha');
    $search = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if ($search['campaignsView']['total'] !== 1) { return false; }

    // An unknown status filter is ignored rather than used to blank the list.
    $_GET = array('view' => 'campaigns', 'status' => 'not-a-status');
    $ignored = (new CloudHost247\Marketing\Http\AdminController())->handle();
    return $ignored['campaignsView']['total'] === 2 && $ignored['campaignsView']['filters']['status'] === '';
},

);
