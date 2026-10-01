<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Marketing\Domain\CampaignAudience;
use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\ListRepository;
use CloudHost247\Marketing\Repositories\SegmentRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\TemplateRepository;
use CloudHost247\Marketing\Security\InputValidator;

/**
 * Campaign lifecycle (requirement #7, #13, #14, #21).
 *
 * Three rules shape everything here:
 *
 *   1. A campaign is approved as a whole. The pre-send checklist is the only
 *      thing that decides whether a campaign may be scheduled, and a state that
 *      is not in `CampaignStatus` cannot be written at all.
 *   2. Content never edits itself into a state. Transitions are explicit and
 *      audited; a scheduled campaign must be paused before its copy changes, so
 *      the text that was approved is the text in the row.
 *   3. The audience is resolved, never frozen into the campaign. Counts shown to
 *      an operator are previews; the send path resolves ids again under the same
 *      rules and refuses when that resolution is not trustworthy.
 *
 * Delivery itself is delegated to a `MessageTransport`. In this session that is
 * a refusal with a reason (SESSION 6 wires the real cPanel SMTP sender), which
 * means a test send can never be mistaken for a delivered message.
 */
final class CampaignService
{
    const MAX_SUBJECT = 150;
    const EDITABLE_STATUSES = array(CampaignStatus::DRAFT, CampaignStatus::READY, CampaignStatus::PAUSED);

    /** Allowed transitions. States outside this map are refused outright. */
    private static $transitions = array(
        CampaignStatus::DRAFT => array(CampaignStatus::READY, CampaignStatus::SCHEDULED, CampaignStatus::CANCELLED),
        CampaignStatus::READY => array(CampaignStatus::DRAFT, CampaignStatus::SCHEDULED, CampaignStatus::CANCELLED),
        CampaignStatus::SCHEDULED => array(CampaignStatus::PAUSED, CampaignStatus::QUEUED, CampaignStatus::CANCELLED),
        CampaignStatus::QUEUED => array(CampaignStatus::SENDING, CampaignStatus::PAUSED, CampaignStatus::CANCELLED),
        CampaignStatus::SENDING => array(CampaignStatus::PAUSED, CampaignStatus::COMPLETED, CampaignStatus::FAILED),
        CampaignStatus::PAUSED => array(CampaignStatus::SCHEDULED, CampaignStatus::CANCELLED, CampaignStatus::DRAFT),
        CampaignStatus::FAILED => array(CampaignStatus::SCHEDULED, CampaignStatus::CANCELLED),
        CampaignStatus::COMPLETED => array(CampaignStatus::ARCHIVED),
        CampaignStatus::CANCELLED => array(CampaignStatus::ARCHIVED),
        CampaignStatus::ARCHIVED => array(),
    );

    private $campaigns;
    private $templates;
    private $lists;
    private $segments;
    private $subscribers;
    private $transport;

    public function __construct(
        CampaignRepository $campaigns = null,
        TemplateRepository $templates = null,
        ListRepository $lists = null,
        SegmentService $segments = null,
        SubscriberRepository $subscribers = null,
        MessageTransport $transport = null
    ) {
        $this->campaigns = $campaigns ?: new CampaignRepository();
        $this->templates = $templates ?: new TemplateRepository();
        $this->lists = $lists ?: new ListRepository();
        $this->segments = $segments ?: new SegmentService();
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->transport = $transport ?: new UnavailableTransport();
    }

    public function repository()
    {
        return $this->campaigns;
    }

    public function transport()
    {
        return $this->transport;
    }

    public static function canTransition($from, $to)
    {
        $from = (string) $from;
        $to = (string) $to;
        return isset(self::$transitions[$from]) && in_array($to, self::$transitions[$from], true);
    }

    // ------------------------------------------------------------ create/edit

    /**
     * Creates a campaign. `idempotency_key` makes a retried create safe: the same
     * key returns the campaign that already exists instead of a duplicate.
     *
     * @param array $input name, subject, preview_text, from_name, from_email,
     *                     reply_to, template_id, audience_type, audience_id,
     *                     idempotency_key
     */
    public function create(array $input, $createdBy = 0)
    {
        $data = $this->normaliseInput($input, null);
        $key = isset($input['idempotency_key']) && trim((string) $input['idempotency_key']) !== ''
            ? substr((string) $input['idempotency_key'], 0, 100)
            : $this->freshKey();

        $existing = $this->campaigns->findByIdempotencyKey($key);
        if ($existing) { return $existing; }

        $data['idempotency_key'] = $key;
        $data['created_by'] = (int) $createdBy;
        $campaign = $this->campaigns->create($data);

        AuditLogger::record('cloudhost247_marketing', 'campaign.created', 'marketing_campaign', (int) $campaign->id, array(), array(
            'name' => (string) $campaign->name,
            'subject' => (string) $campaign->subject,
            'audience_type' => (string) $campaign->audience_type,
            'audience_id' => (int) $campaign->audience_id,
            'idempotency_key' => $key,
        ), 'success');

        return $campaign;
    }

    /** Updates content. Only draft, ready and paused campaigns are editable. */
    public function update($id, array $input)
    {
        $campaign = $this->requireCampaign($id);
        $this->requireEditable($campaign);

        $data = $this->normaliseInput($input, $campaign);
        $before = array(
            'subject' => (string) $campaign->subject,
            'audience_type' => (string) $campaign->audience_type,
            'audience_id' => (int) $campaign->audience_id,
            'template_id' => $campaign->template_id === null ? null : (int) $campaign->template_id,
        );
        $campaign = $this->campaigns->update((int) $campaign->id, $data);

        // A content edit returns an approved campaign to draft: what was
        // approved is no longer what the row holds, and the operator re-approves.
        if ($campaign->status === CampaignStatus::READY) {
            $campaign = $this->campaigns->setStatus((int) $campaign->id, CampaignStatus::DRAFT);
        }

        AuditLogger::record('cloudhost247_marketing', 'campaign.updated', 'marketing_campaign', (int) $campaign->id, $before, array(
            'name' => (string) $campaign->name,
            'subject' => (string) $campaign->subject,
            'audience_type' => (string) $campaign->audience_type,
            'audience_id' => (int) $campaign->audience_id,
            'blocks_updated' => array_key_exists('html', $data),
        ), 'success');

        return $campaign;
    }

    private function normaliseInput(array $input, $existing)
    {
        $pick = function ($field, $default = '') use ($input, $existing) {
            if (array_key_exists($field, $input)) { return $input[$field]; }
            if ($existing && isset($existing->{$field})) { return $existing->{$field}; }
            return $default;
        };

        $name = InputValidator::shortText((string) $pick('name'), 128, 'Campaign name');
        if (trim($name) === '') { throw new \InvalidArgumentException('A campaign needs a name.'); }

        $subject = (string) $pick('subject');
        if (preg_match('/[\r\n]/', $subject)) { throw new \InvalidArgumentException('The subject line cannot contain line breaks.'); }
        $subject = InputValidator::shortText(trim($subject), self::MAX_SUBJECT, 'Subject');

        $fromName = InputValidator::shortText((string) $pick('from_name'), 128, 'Sender name');
        if (trim($fromName) === '') { throw new \InvalidArgumentException('A campaign needs a sender name.'); }

        $fromEmail = InputValidator::email((string) $pick('from_email'), 'Sender address');
        $replyTo = trim((string) $pick('reply_to'));
        if ($replyTo !== '') { $replyTo = InputValidator::email($replyTo, 'Reply-to address'); }

        $audienceType = (string) $pick('audience_type', CampaignAudience::LIST);
        if (!CampaignAudience::isValid($audienceType)) {
            throw new \InvalidArgumentException('Choose a mailing list, a segment, or all subscribed addresses.');
        }
        $audienceId = (int) $pick('audience_id', 0);
        if (CampaignAudience::needsReference($audienceType)) {
            if ($audienceId <= 0) { throw new \InvalidArgumentException('Choose the ' . ($audienceType === CampaignAudience::LIST ? 'list' : 'segment') . ' this campaign addresses.'); }
            $exists = $audienceType === CampaignAudience::LIST
                ? $this->lists->find($audienceId)
                : (new SegmentRepository())->find($audienceId);
            if (!$exists) { throw new \InvalidArgumentException('That ' . ($audienceType === CampaignAudience::LIST ? 'list' : 'segment') . ' does not exist.'); }
        } else {
            $audienceId = 0;
        }

        $templateId = $pick('template_id', null);
        $templateId = ($templateId === null || (int) $templateId <= 0) ? null : (int) $templateId;
        $design = null;
        $html = $existing ? (string) $existing->html : '';
        $text = $existing ? (string) $existing->text : '';
        if ($templateId !== null) {
            $template = $this->templates->find($templateId);
            if (!$template) { throw new \InvalidArgumentException('That template does not exist.'); }
            if ($template->status !== 'active') { throw new \InvalidArgumentException('That template is archived; reactivate it or choose another.'); }
            // The campaign copies the rendered template now: a later edit of the
            // library entry must not silently change an approved campaign.
            $design = TemplateRepository::designOf($template);
            $html = (string) $template->html;
            $text = (string) $template->text;
        }

        return array(
            'name' => $name,
            'subject' => $subject,
            'preview_text' => InputValidator::shortText((string) $pick('preview_text'), 255, 'Preview text'),
            'from_name' => $fromName,
            'from_email' => $fromEmail,
            'reply_to' => $replyTo,
            'template_id' => $templateId,
            'design' => $design,
            'html' => $html,
            'text' => $text,
            'audience_type' => $audienceType,
            'audience_id' => $audienceId,
        );
    }

    private function freshKey()
    {
        return 'cmp-' . substr(hash('sha256', uniqid('cloudhost247-marketing', true)), 0, 40);
    }

    // --------------------------------------------------------------- checklist

    /**
     * The pre-send checklist. Blocking items stop a schedule or a test send;
     * non-blocking items are shown so an operator is never surprised later.
     *
     * @return array<int,array{key:string,label:string,ok:bool,detail:string,blocking:bool}>
     */
    public function checklist($campaign)
    {
        $audience = $this->audiencePreview($campaign);
        $subject = (string) $campaign->subject;

        return array(
            $this->check('name', 'Campaign name', trim((string) $campaign->name) !== '', 'Operators need a name they recognise in the list.', true),
            $this->check('subject', 'Subject line',
                trim($subject) !== '' && strlen($subject) <= self::MAX_SUBJECT && !preg_match('/[\r\n]/', $subject),
                'A single line of at most ' . self::MAX_SUBJECT . ' characters.', true),
            $this->check('from_email', 'Sender address',
                InputValidator::isPlausibleEmail((string) $campaign->from_email),
                'The address each message is sent from.', true),
            $this->check('from_name', 'Sender name', trim((string) $campaign->from_name) !== '', 'Shown as the sender in most clients.', true),
            $this->check('reply_to', 'Reply-to address',
                trim((string) $campaign->reply_to) === '' || InputValidator::isPlausibleEmail((string) $campaign->reply_to),
                'Optional; when set, replies go there instead of the sender address.', true),
            $this->check('content', 'Message content',
                trim((string) $campaign->html) !== '' && trim((string) $campaign->text) !== '',
                'Choose a template so the campaign carries both an HTML and a plain-text body.', true),
            $this->check('audience', 'Audience', $audience['count'] > 0, $audience['detail'], true),
            $this->senderDomainCheck($campaign),
            $this->check('transport', 'Delivery provider',
                $this->transport->isAvailable(),
                $this->transport->isAvailable() ? 'Provider: ' . $this->transport->key() . '.' : $this->transport->reason(),
                false),
        );
    }

    /** @return string[] the labels of failing blocking checks */
    public function blockingIssues($campaign)
    {
        $issues = array();
        foreach ($this->checklist($campaign) as $check) {
            if ($check['blocking'] && !$check['ok']) { $issues[] = $check['label'] . ': ' . $check['detail']; }
        }
        return $issues;
    }

    /**
     * The provider's sender-domain rule, reported by the provider itself. A
     * transport that states no policy is shown as not enforced instead of
     * silently passing, and a stated failure blocks a schedule like any other.
     */
    private function senderDomainCheck($campaign)
    {
        if (!($this->transport instanceof SenderPolicy)) {
            return $this->check('sender_domain', 'Sender domain', true,
                'The delivery provider does not state a sender-domain policy.', false);
        }
        $policy = $this->transport->senderPolicy((string) $campaign->from_email);
        return $this->check('sender_domain', 'Sender domain', !empty($policy['ok']),
            (string) $policy['detail'], !empty($policy['enforced']));
    }

    private function check($key, $label, $ok, $detail, $blocking)
    {
        return array('key' => $key, 'label' => $label, 'ok' => (bool) $ok, 'detail' => $detail, 'blocking' => (bool) $blocking);
    }

    /**
     * Resolves the audience for display. The number is a preview: it is resolved
     * again at send time under the same rules, and a segment that cannot be
     * verified is reported as such rather than rounded to a comfortable number.
     */
    public function audiencePreview($campaign)
    {
        $type = (string) $campaign->audience_type;
        if (!CampaignAudience::isValid($type)) {
            return array('count' => 0, 'detail' => 'This campaign has no usable audience type.', 'issues' => array('Unknown audience type.'));
        }

        if ($type === CampaignAudience::ALL) {
            $counts = $this->subscribers->countsByStatus();
            $count = isset($counts[SubscriberStatus::SUBSCRIBED]) ? (int) $counts[SubscriberStatus::SUBSCRIBED] : 0;
            return array('count' => $count, 'detail' => number_format($count) . ' subscribed address(es); suppression and consent are applied again at send time.', 'issues' => array());
        }

        if ($type === CampaignAudience::LIST) {
            $list = $this->lists->find((int) $campaign->audience_id);
            if (!$list) {
                return array('count' => 0, 'detail' => 'The selected list no longer exists.', 'issues' => array('The selected list was deleted or archived.'));
            }
            $subscribed = $this->subscribers->paginate(array('list_id' => (int) $list->id, 'status' => SubscriberStatus::SUBSCRIBED), 1, 1);
            $members = $this->lists->memberCount((int) $list->id);
            return array(
                'count' => (int) $subscribed['total'],
                'detail' => number_format((int) $subscribed['total']) . ' subscribed of ' . number_format($members) . ' member(s) on "' . $list->name . '"; suppression and consent are applied again at send time.',
                'issues' => array(),
            );
        }

        $segment = (new SegmentRepository())->find((int) $campaign->audience_id);
        if (!$segment) {
            return array('count' => 0, 'detail' => 'The selected segment no longer exists.', 'issues' => array('The selected segment was deleted.'));
        }
        if ($segment->status !== 'active') {
            return array('count' => 0, 'detail' => 'The selected segment is archived.', 'issues' => array('Archived segments cannot address a campaign.'));
        }

        $result = $this->segments->evaluate(SegmentRepository::definitionOf($segment));
        $issues = array();
        if ($result['truncated']) { $issues[] = 'The segment exceeds the evaluation scan limit, so the count is a floor, not a total.'; }
        if ($result['unverified'] > 0) { $issues[] = number_format($result['unverified']) . ' subscriber(s) had customer-side conditions that could not be verified and are excluded.'; }
        if ($result['error'] !== '') { $issues[] = $result['error']; }
        return array(
            'count' => (int) $result['count'],
            'detail' => number_format($result['count']) . ' matching subscriber(s) in "' . $segment->name . '"; resolved live, then resolved again at send time.',
            'issues' => $issues,
        );
    }

    /**
     * Resolves a campaign's segment audience to subscriber ids for the worker.
     * It refuses when the evaluation is not trustworthy — a truncated scan or
     * unverifiable customer conditions — because sending to a partial audience
     * is worse than not sending at all.
     *
     * @return int[]
     */
    public function segmentIds($segmentId, $limit = 20000)
    {
        return $this->segments->subscriberIds((int) $segmentId, (int) $limit);
    }

    // -------------------------------------------------------------- transitions

    public function markReady($id)
    {
        $campaign = $this->requireCampaign($id);
        return $this->transition($campaign, CampaignStatus::READY, array(), 'campaign.ready',
            'Campaign marked ready for scheduling.');
    }

    public function schedule($id, $datetime, $timezone = 'UTC')
    {
        $campaign = $this->requireCampaign($id);
        $issues = $this->blockingIssues($campaign);
        if ($issues) {
            throw new \RuntimeException('The campaign is not ready: ' . implode(' ', $issues));
        }
        $when = $this->normaliseSchedule($datetime, $timezone);
        return $this->transition($campaign, CampaignStatus::SCHEDULED, array(
            'scheduled_at' => $when['utc'],
            'scheduled_timezone' => $when['timezone'],
            'failure_reason' => '',
        ), 'campaign.scheduled', 'Campaign scheduled for ' . $when['utc'] . ' UTC (' . $when['local'] . ' ' . $when['timezone'] . ').');
    }

    /**
     * Queues an approved campaign for the next worker pass, without picking a
     * calendar moment. It is a deliberate, audited action: the same blocking
     * checks apply, so "send now" cannot be used to skip the checklist.
     */
    public function sendNow($id)
    {
        $campaign = $this->requireCampaign($id);
        $issues = $this->blockingIssues($campaign);
        if ($issues) {
            throw new \RuntimeException('The campaign is not ready: ' . implode(' ', $issues));
        }
        $now = date('Y-m-d H:i:s');
        return $this->transition($campaign, CampaignStatus::SCHEDULED, array(
            'scheduled_at' => $now,
            'scheduled_timezone' => 'UTC',
            'failure_reason' => '',
        ), 'campaign.queued_now', 'Campaign approved for immediate delivery; the worker will queue it on its next pass.');
    }

    public function pause($id)
    {
        $campaign = $this->requireCampaign($id);
        return $this->transition($campaign, CampaignStatus::PAUSED, array(), 'campaign.paused',
            'Campaign paused. Its schedule is retained and no further messages will be queued.');
    }

    /** Resuming needs a future moment: a schedule that has passed cannot be reused. */
    public function resume($id, $datetime = null, $timezone = null)
    {
        $campaign = $this->requireCampaign($id);
        $issues = $this->blockingIssues($campaign);
        if ($issues) {
            throw new \RuntimeException('The campaign is no longer ready: ' . implode(' ', $issues));
        }
        $timezone = $timezone !== null && trim((string) $timezone) !== '' ? (string) $timezone : (string) $campaign->scheduled_timezone;
        if ($datetime === null || trim((string) $datetime) === '') {
            if ($campaign->scheduled_at === null) { throw new \InvalidArgumentException('Choose a new send time.'); }
            $datetime = (string) $campaign->scheduled_at;
            $timezone = 'UTC';
        }
        $when = $this->normaliseSchedule($datetime, $timezone);
        return $this->transition($campaign, CampaignStatus::SCHEDULED, array(
            'scheduled_at' => $when['utc'],
            'scheduled_timezone' => $when['timezone'],
        ), 'campaign.resumed', 'Campaign resumed for ' . $when['utc'] . ' UTC.');
    }

    public function cancel($id)
    {
        $campaign = $this->requireCampaign($id);
        return $this->transition($campaign, CampaignStatus::CANCELLED, array(), 'campaign.cancelled',
            'Campaign cancelled. Nothing further will be queued.');
    }

    public function archive($id)
    {
        $campaign = $this->requireCampaign($id);
        return $this->transition($campaign, CampaignStatus::ARCHIVED, array(), 'campaign.archived',
            'Campaign archived.');
    }

    private function transition($campaign, $to, array $extra, $action, $message)
    {
        $from = (string) $campaign->status;
        if (!self::canTransition($from, $to)) {
            throw new \RuntimeException('A campaign in "' . CampaignStatus::label($from) . '" cannot move to "' . CampaignStatus::label($to) . '".');
        }
        $campaign = $this->campaigns->setStatus((int) $campaign->id, $to, $extra);
        AuditLogger::record('cloudhost247_marketing', $action, 'marketing_campaign', (int) $campaign->id,
            array('status' => $from), array_merge(array('status' => $to), $extra), 'success');
        return array('campaign' => $campaign, 'message' => $message);
    }

    /** Parses a local wall-clock time in the chosen zone and stores UTC. */
    private function normaliseSchedule($datetime, $timezone)
    {
        $datetime = trim((string) $datetime);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/', $datetime)) {
            throw new \InvalidArgumentException('Choose a send time formatted YYYY-MM-DD HH:MM.');
        }
        $timezone = trim((string) $timezone);
        if ($timezone === '' || !in_array($timezone, \DateTimeZone::listIdentifiers(), true)) {
            throw new \InvalidArgumentException('Choose a valid timezone.');
        }
        try {
            $local = new \DateTimeImmutable(str_replace('T', ' ', $datetime), new \DateTimeZone($timezone));
        } catch (\Throwable $error) {
            throw new \InvalidArgumentException('That send time could not be understood.');
        }
        $utc = $local->setTimezone(new \DateTimeZone('UTC'));
        if ($utc->getTimestamp() <= time()) {
            throw new \InvalidArgumentException('Choose a send time in the future.');
        }
        return array(
            'utc' => $utc->format('Y-m-d H:i:s'),
            'local' => $local->format('Y-m-d H:i:s'),
            'timezone' => $timezone,
        );
    }

    // -------------------------------------------------------------- test send

    /**
     * Sends one test message to one address. It goes through the same checklist
     * and the same transport as a real send, and a refusal is audited with its
     * reason — a test send never pretends to have been delivered.
     *
     * @return array{subject:string,provider_message_id:string,transport:string}
     */
    public function sendTest($id, $email)
    {
        $campaign = $this->requireCampaign($id);
        $email = InputValidator::email($email, 'Test address');

        $issues = $this->blockingIssues($campaign);
        if ($issues) {
            AuditLogger::record('cloudhost247_marketing', 'campaign.test_refused', 'marketing_campaign', (int) $campaign->id,
                array(), array('email' => $email, 'reason' => 'checklist'), 'denied', implode(' ', $issues));
            throw new \RuntimeException('The campaign is not ready: ' . implode(' ', $issues));
        }

        if (!$this->transport->isAvailable()) {
            AuditLogger::record('cloudhost247_marketing', 'campaign.test_refused', 'marketing_campaign', (int) $campaign->id,
                array(), array('email' => $email, 'reason' => 'transport_unavailable'), 'denied', $this->transport->reason());
            throw new \RuntimeException($this->transport->reason());
        }

        $message = $this->message($campaign, $email, 'Test');
        $result = $this->transport->send($message);
        if (empty($result['ok'])) {
            AuditLogger::record('cloudhost247_marketing', 'campaign.test_failed', 'marketing_campaign', (int) $campaign->id,
                array(), array('email' => $email, 'transport' => $this->transport->key()), 'failure', (string) $result['error']);
            throw new \RuntimeException('The provider refused the test message: ' . $result['error']);
        }

        AuditLogger::record('cloudhost247_marketing', 'campaign.test_sent', 'marketing_campaign', (int) $campaign->id,
            array(), array('email' => $email, 'subject' => $message['subject'], 'transport' => $this->transport->key()), 'success');

        return array(
            'subject' => $message['subject'],
            'provider_message_id' => isset($result['provider_message_id']) ? (string) $result['provider_message_id'] : '',
            'transport' => $this->transport->key(),
        );
    }

    /** Builds the exact message a real send would hand to the transport. */
    public function message($campaign, $to, $prefix = '')
    {
        $subject = (string) $campaign->subject;
        if ($prefix !== '') { $subject = '[' . $prefix . '] ' . $subject; }
        $subject = substr($subject, 0, self::MAX_SUBJECT);

        return array(
            'to' => $to,
            'to_name' => '',
            'subject' => $subject,
            'html' => (string) $campaign->html,
            'text' => (string) $campaign->text,
            'from_email' => (string) $campaign->from_email,
            'from_name' => (string) $campaign->from_name,
            'reply_to' => (string) $campaign->reply_to,
            'headers' => array('X-CloudHost247-Campaign' => (int) $campaign->id),
        );
    }

    // ------------------------------------------------------------------ guards

    private function requireCampaign($id)
    {
        $campaign = $this->campaigns->find((int) $id);
        if (!$campaign) { throw new \InvalidArgumentException('Unknown campaign.'); }
        return $campaign;
    }

    private function requireEditable($campaign)
    {
        if (!in_array((string) $campaign->status, self::EDITABLE_STATUSES, true)) {
            throw new \RuntimeException('A campaign in "' . CampaignStatus::label($campaign->status) . '" is not editable. Pause it first, or copy it into a new draft.');
        }
    }
}
