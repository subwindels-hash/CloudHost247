<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Marketing\Domain\AutomationRunStatus;
use CloudHost247\Marketing\Domain\AutomationStatus;
use CloudHost247\Marketing\Domain\AutomationStepType;
use CloudHost247\Marketing\Domain\AutomationTrigger;
use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\ConsentStatus;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Repositories\AutomationRepository;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\QueueRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\SuppressionRepository;
use CloudHost247\Marketing\Repositories\TemplateRepository;
use CloudHost247\Marketing\Security\InputValidator;

/**
 * Automation (SESSION 10).
 *
 * A journey is a list of steps (wait, send email) and a run is one subscriber
 * walking it. Three rules shape everything here:
 *
 *  1. **Nothing is delivered by this class.** A send step puts a row on the same
 *     queue every campaign uses, and the same worker, suppression checks,
 *     throttling, backoff, tracking and ledger apply. An automation is a way of
 *     *filling* the queue, never a second delivery path.
 *  2. **One live journey per subscriber.** A retried hook cannot enrol the same
 *     address twice (the enrolment key is unique); re-enrolment is only possible
 *     when the operator said so, and it is a new run, never a rewrite.
 *  3. **Stopping always works.** Unsubscribing, being suppressed, or the
 *     automation being archived cancels the live runs — a person who left must
 *     not keep receiving a drip from a queue that was filled before they left.
 *
 * Because a run advances at most one step per pass, a burst of send steps is
 * spread over successive cron minutes rather than fired in one loop.
 */
final class AutomationService
{
    const MAX_STEPS = 50;
    const MAX_WAIT_MINUTES = 43200; // 30 days
    const MAX_TRIGGER_DELAY_MINUTES = 10080; // 7 days
    const TICK_BATCH = 100;

    private $automations;
    private $campaigns;
    private $templates;
    private $queue;
    private $settings;
    private $subscribers;
    private $suppressions;

    public function __construct(
        AutomationRepository $automations = null,
        CampaignRepository $campaigns = null,
        TemplateRepository $templates = null,
        QueueRepository $queue = null,
        SettingsRepository $settings = null,
        SubscriberRepository $subscribers = null,
        SuppressionRepository $suppressions = null
    ) {
        $this->automations = $automations ?: new AutomationRepository();
        $this->campaigns = $campaigns ?: new CampaignRepository();
        $this->templates = $templates ?: new TemplateRepository();
        $this->queue = $queue ?: new QueueRepository();
        $this->settings = $settings ?: new SettingsRepository();
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->suppressions = $suppressions ?: new SuppressionRepository();
    }

    public function repository() { return $this->automations; }

    // ---------------------------------------------------------------- authoring

    /**
     * @param array $input name, description, trigger_type, list_id,
     *                     trigger_delay_minutes, reenrollable, idempotency_key
     */
    public function create(array $input, $createdBy = 0)
    {
        $name = InputValidator::shortText(isset($input['name']) ? $input['name'] : '', 128, 'Automation name');
        if (trim($name) === '') { throw new \InvalidArgumentException('An automation needs a name.'); }

        $key = isset($input['idempotency_key']) && trim((string) $input['idempotency_key']) !== ''
            ? substr((string) $input['idempotency_key'], 0, 100)
            : 'automation:' . bin2hex(random_bytes(16));
        $existing = $this->automations->findByIdempotencyKey($key);
        if ($existing) { return $existing; }

        $automation = $this->automations->create(array(
            'name' => $name,
            'description' => InputValidator::shortText(isset($input['description']) ? $input['description'] : '', 255, 'Description'),
            'status' => AutomationStatus::DRAFT,
            'trigger_type' => $this->normaliseTrigger(isset($input['trigger_type']) ? $input['trigger_type'] : '', isset($input['list_id']) ? $input['list_id'] : 0),
            'list_id' => AutomationTrigger::requiresList(isset($input['trigger_type']) ? $input['trigger_type'] : '') ? (int) $input['list_id'] : null,
            'trigger_delay_minutes' => $this->normaliseDelay(isset($input['trigger_delay_minutes']) ? $input['trigger_delay_minutes'] : 0),
            'reenrollable' => !empty($input['reenrollable']) ? 1 : 0,
            'campaign_id' => 0,
            'created_by' => (int) $createdBy,
            'idempotency_key' => $key,
        ));

        AuditLogger::record('cloudhost247_marketing', 'automation.created', 'marketing_automation', (int) $automation->id,
            array(), array('name' => $name, 'trigger_type' => (string) $automation->trigger_type), 'success');
        return $automation;
    }

    public function update($id, array $input)
    {
        $automation = $this->requireAutomation($id);
        if ((string) $automation->status === AutomationStatus::ARCHIVED) {
            throw new \RuntimeException('An archived automation is read-only. Create a new journey instead.');
        }
        $trigger = array_key_exists('trigger_type', $input) ? (string) $input['trigger_type'] : (string) $automation->trigger_type;
        $listId = array_key_exists('list_id', $input) ? (int) $input['list_id'] : (int) $automation->list_id;

        $before = array('name' => (string) $automation->name, 'trigger_type' => (string) $automation->trigger_type, 'list_id' => (int) $automation->list_id);
        $updated = $this->automations->update((int) $automation->id, array(
            'name' => InputValidator::shortText(isset($input['name']) ? $input['name'] : $automation->name, 128, 'Automation name'),
            'description' => InputValidator::shortText(isset($input['description']) ? $input['description'] : $automation->description, 255, 'Description'),
            'trigger_type' => $this->normaliseTrigger($trigger, $listId),
            'list_id' => AutomationTrigger::requiresList($trigger) ? $listId : null,
            'trigger_delay_minutes' => $this->normaliseDelay(isset($input['trigger_delay_minutes']) ? $input['trigger_delay_minutes'] : $automation->trigger_delay_minutes),
            'reenrollable' => !empty($input['reenrollable']) ? 1 : 0,
        ));

        AuditLogger::record('cloudhost247_marketing', 'automation.updated', 'marketing_automation', (int) $automation->id,
            $before, array('name' => (string) $updated->name, 'trigger_type' => (string) $updated->trigger_type), 'success');
        return $updated;
    }

    /**
     * Appends a step. A journey is authored in order and the engine reads it in
     * order, so there is no position parameter to get wrong.
     *
     * @param array $input step_type, wait_minutes (wait), template_id + subject
     *                     (send_email), from_name/from_email (optional)
     */
    public function addStep($automationId, array $input)
    {
        $automation = $this->requireAutomation($automationId);
        if ((string) $automation->status === AutomationStatus::ARCHIVED) {
            throw new \RuntimeException('An archived automation is read-only.');
        }
        $steps = $this->automations->steps((int) $automation->id);
        if (count($steps) >= self::MAX_STEPS) {
            throw new \RuntimeException('An automation holds at most ' . self::MAX_STEPS . ' steps.');
        }

        $type = isset($input['step_type']) ? (string) $input['step_type'] : '';
        if (!AutomationStepType::isValid($type)) {
            throw new \InvalidArgumentException('Choose a wait or a send-email step.');
        }

        $data = array(
            'step_type' => $type,
            'wait_minutes' => 0,
            'template_id' => null,
            'subject' => '',
            'from_name' => '',
            'from_email' => '',
            'config_json' => null,
        );
        if ($type === AutomationStepType::WAIT) {
            $data['wait_minutes'] = $this->normaliseWait(isset($input['wait_minutes']) ? $input['wait_minutes'] : 0);
        } else {
            $templateId = isset($input['template_id']) ? (int) $input['template_id'] : 0;
            $data['template_id'] = $this->requireUsableTemplate($templateId);
            $subject = (string) (isset($input['subject']) ? $input['subject'] : '');
            if (preg_match('/[\r\n]/', $subject)) { throw new \InvalidArgumentException('The subject line cannot contain line breaks.'); }
            $subject = trim(InputValidator::shortText($subject, 255, 'Subject'));
            if ($subject === '') { throw new \InvalidArgumentException('A send step needs a subject line.'); }
            $data['subject'] = $subject;
            if (!empty($input['from_name'])) { $data['from_name'] = InputValidator::shortText($input['from_name'], 128, 'Sender name'); }
            if (!empty($input['from_email'])) { $data['from_email'] = InputValidator::email($input['from_email'], 'Sender address'); }
        }

        $step = $this->automations->addStep((int) $automation->id, $data);
        AuditLogger::record('cloudhost247_marketing', 'automation.step_added', 'marketing_automation', (int) $automation->id,
            array(), array('step_type' => $type, 'position' => (int) $step->position), 'success');
        return $step;
    }

    public function removeStep($automationId, $stepId)
    {
        $automation = $this->requireAutomation($automationId);
        if ((string) $automation->status === AutomationStatus::ARCHIVED) {
            throw new \RuntimeException('An archived automation is read-only.');
        }
        $step = null;
        foreach ($this->automations->steps((int) $automation->id) as $row) {
            if ((int) $row->id === (int) $stepId) { $step = $row; }
        }
        if (!$step) { throw new \InvalidArgumentException('That step does not belong to this automation.'); }
        $this->automations->removeStep((int) $step->id);
        AuditLogger::record('cloudhost247_marketing', 'automation.step_removed', 'marketing_automation', (int) $automation->id,
            array('step_type' => (string) $step->step_type, 'position' => (int) $step->position), array(), 'success');
        return true;
    }

    public function activate($id)
    {
        $automation = $this->requireAutomation($id);
        $issues = $this->activationIssues($automation);
        if ($issues) { throw new \RuntimeException(implode(' ', $issues)); }

        // Every automation owns one container campaign: the queue rows, the
        // registered links and the ledger events all point at it, so tracking and
        // reporting work exactly as they do for a campaign.
        $campaignId = (int) $automation->campaign_id;
        if ($campaignId <= 0) {
            $container = $this->campaigns->createContainer(
                'Automation: ' . (string) $automation->name,
                'automation-container:' . (int) $automation->id,
                (int) $automation->created_by
            );
            $campaignId = (int) $container->id;
        }
        $container = $this->campaigns->find($campaignId);
        if (!$container) { throw new \RuntimeException('The automation container campaign could not be created.'); }
        if ((string) $container->status !== CampaignStatus::SENDING) {
            $this->campaigns->setStatus($campaignId, CampaignStatus::SENDING, array('started_at' => date('Y-m-d H:i:s')));
        }

        $updated = $this->automations->update((int) $automation->id, array(
            'status' => AutomationStatus::ACTIVE,
            'campaign_id' => $campaignId,
            'activated_at' => date('Y-m-d H:i:s'),
            'paused_at' => null,
        ));
        AuditLogger::record('cloudhost247_marketing', 'automation.activated', 'marketing_automation', (int) $automation->id,
            array('status' => (string) $automation->status), array('status' => AutomationStatus::ACTIVE, 'container_campaign' => $campaignId), 'success');
        return $updated;
    }

    /** Pausing stops new enrolments and freezes live runs where they are. */
    public function pause($id)
    {
        $automation = $this->requireAutomation($id);
        if ((string) $automation->status === AutomationStatus::ARCHIVED) {
            throw new \RuntimeException('An archived automation cannot be paused.');
        }
        $updated = $this->automations->update((int) $automation->id, array(
            'status' => AutomationStatus::PAUSED,
            'paused_at' => date('Y-m-d H:i:s'),
        ));
        AuditLogger::record('cloudhost247_marketing', 'automation.paused', 'marketing_automation', (int) $automation->id,
            array('status' => (string) $automation->status), array('status' => AutomationStatus::PAUSED), 'success');
        return $updated;
    }

    /** Archiving stops everything: live runs are cancelled, not left hanging. */
    public function archive($id)
    {
        $automation = $this->requireAutomation($id);
        $cancelled = $this->cancelRuns((int) $automation->id, 'archived');
        $updated = $this->automations->update((int) $automation->id, array(
            'status' => AutomationStatus::ARCHIVED,
            'archived_at' => date('Y-m-d H:i:s'),
        ));
        AuditLogger::record('cloudhost247_marketing', 'automation.archived', 'marketing_automation', (int) $automation->id,
            array('status' => (string) $automation->status), array('status' => AutomationStatus::ARCHIVED, 'runs_cancelled' => $cancelled), 'success');
        return $updated;
    }

    /** What is missing before this automation can enrol anybody. */
    public function activationIssues($automation)
    {
        $issues = array();
        if (trim((string) $automation->name) === '') { $issues[] = 'The automation needs a name.'; }
        if (!AutomationTrigger::isValid((string) $automation->trigger_type)) { $issues[] = 'Choose a trigger.'; }
        if (AutomationTrigger::requiresList((string) $automation->trigger_type) && (int) $automation->list_id <= 0) {
            $issues[] = 'Choose the list whose new members start this journey.';
        }
        $steps = $this->automations->steps((int) $automation->id);
        if (!$steps) { $issues[] = 'Add at least one step.'; return $issues; }
        if (!$this->automations->hasSendStep((int) $automation->id)) { $issues[] = 'Add at least one send-email step.'; }
        foreach ($steps as $step) {
            if (AutomationStepType::isSending((string) $step->step_type)) {
                try {
                    $this->requireUsableTemplate((int) $step->template_id);
                } catch (\InvalidArgumentException $error) {
                    $issues[] = 'Step ' . (int) $step->position . ': ' . $error->getMessage();
                }
                if (trim((string) $step->subject) === '') {
                    $issues[] = 'Step ' . (int) $step->position . ': the send step needs a subject line.';
                }
            } else {
                if ((int) $step->wait_minutes < 1) { $issues[] = 'Step ' . (int) $step->position . ': the wait needs a positive number of minutes.'; }
            }
        }
        return $issues;
    }

    // ---------------------------------------------------------------- enrolment

    /**
     * Puts one subscriber at the start of a journey.
     *
     * @return array{ok:bool,reason:string,run:object|null,created:bool}
     */
    public function enroll($automationId, $subscriberId, $by = 'manual')
    {
        $automation = $this->automations->find($automationId);
        if (!$automation) { return array('ok' => false, 'reason' => 'not_found', 'run' => null, 'created' => false); }
        if (!AutomationStatus::isEnrolling((string) $automation->status)) {
            return array('ok' => false, 'reason' => 'not_active', 'run' => null, 'created' => false);
        }
        $subscriber = $this->subscribers->find($subscriberId);
        if (!$subscriber) { return array('ok' => false, 'reason' => 'subscriber_missing', 'run' => null, 'created' => false); }

        $addressable = $this->addressability($subscriber);
        if ($addressable !== '') { return array('ok' => false, 'reason' => $addressable, 'run' => null, 'created' => false); }

        // One live journey per subscriber, whatever the re-enrolment setting:
        // enrolling somebody who is already mid-journey returns that journey.
        $live = $this->automations->activeRun((int) $automation->id, (int) $subscriber->id);
        if ($live) { return array('ok' => true, 'reason' => 'already_enrolled', 'run' => $live, 'created' => false); }

        $key = $this->enrolmentKey($automation, (int) $subscriber->id);
        $existing = $this->automations->findRunByKey($key);
        if ($existing) { return array('ok' => true, 'reason' => 'already_enrolled', 'run' => $existing, 'created' => false); }

        $now = date('Y-m-d H:i:s');
        $run = $this->automations->createRun(array(
            'automation_id' => (int) $automation->id,
            'subscriber_id' => (int) $subscriber->id,
            'email' => (string) $subscriber->email,
            'status' => AutomationRunStatus::RUNNING,
            'position' => 0,
            'sent_count' => 0,
            'next_run_at' => date('Y-m-d H:i:s', time() + ((int) $automation->trigger_delay_minutes * 60)),
            'enrolled_at' => $now,
            'completed_at' => null,
            'cancelled_at' => null,
            'last_error' => '',
            'enrolment_key' => $key,
        ));

        AuditLogger::record('cloudhost247_marketing', 'automation.enrolled', 'marketing_automation', (int) $automation->id,
            array(), array('subscriber_id' => (int) $subscriber->id, 'by' => (string) $by), 'success');
        return array('ok' => true, 'reason' => 'enrolled', 'run' => $run, 'created' => true);
    }

    /**
     * Fires the trigger hooks after a subscriber was added or joined a list.
     * Never throws: subscribing must work even if an automation is misconfigured.
     *
     * @return int number of journeys started
     */
    public function enrollForSubscriber($subscriberId, array $listIds = array(), $isNew = false)
    {
        $started = 0;
        try {
            $candidates = array();
            if ($isNew) {
                foreach ($this->automations->enrollingFor(AutomationTrigger::SUBSCRIBER_ADDED) as $automation) { $candidates[(int) $automation->id] = $automation; }
            }
            foreach (array_unique(array_map('intval', $listIds)) as $listId) {
                if ($listId <= 0) { continue; }
                foreach ($this->automations->enrollingFor(AutomationTrigger::LIST_JOINED, $listId) as $automation) { $candidates[(int) $automation->id] = $automation; }
            }
            foreach ($candidates as $automation) {
                $result = $this->enroll((int) $automation->id, (int) $subscriberId, 'trigger');
                if (!empty($result['created'])) { $started++; }
            }
        } catch (\Throwable $error) {
            AuditLogger::record('cloudhost247_marketing', 'automation.enrolment_failed', 'marketing_automation', 0,
                array('subscriber_id' => (int) $subscriberId), array(), 'failure', $error->getMessage());
        }
        return $started;
    }

    /** Called when an address leaves: no queued message may outlive consent. */
    public function cancelRunsForSubscriber($subscriberId, $reason = 'unsubscribed')
    {
        $cancelled = 0;
        foreach ($this->automations->activeRunsForSubscriber((int) $subscriberId) as $run) {
            $this->cancelRun((int) $run->id, (string) $reason);
            $cancelled++;
        }
        return $cancelled;
    }

    private function cancelRuns($automationId, $reason)
    {
        $cancelled = 0;
        foreach ($this->automations->liveRuns((int) $automationId) as $run) {
            $this->cancelRun((int) $run->id, (string) $reason);
            $cancelled++;
        }
        return $cancelled;
    }

    private function cancelRun($runId, $reason)
    {
        $run = $this->automations->findRun($runId);
        if (!$run) { return false; }
        if (AutomationRunStatus::isTerminal((string) $run->status)) { return false; }
        $this->automations->updateRun($runId, array(
            'status' => AutomationRunStatus::CANCELLED,
            'cancelled_at' => date('Y-m-d H:i:s'),
            'last_error' => substr((string) $reason, 0, 255),
        ));
        return true;
    }

    // ------------------------------------------------------------------ engine

    /**
     * Advances every due run by one step.
     *
     * @return array{processed:int,messages:int,waited:int,completed:int,cancelled:int,held:int,failed:int,errors:string[]}
     */
    public function tick($limit = 0)
    {
        $limit = $limit > 0 ? (int) $limit : self::TICK_BATCH;
        $now = date('Y-m-d H:i:s');
        $out = array('processed' => 0, 'messages' => 0, 'waited' => 0, 'completed' => 0, 'cancelled' => 0, 'held' => 0, 'failed' => 0, 'errors' => array());

        foreach ($this->automations->dueRuns($now, $limit) as $run) {
            $automation = $this->automations->find((int) $run->automation_id);
            if (!$automation) {
                $this->cancelRun((int) $run->id, 'automation_deleted');
                $out['cancelled']++;
                continue;
            }
            $status = (string) $automation->status;
            if ($status === AutomationStatus::ARCHIVED) {
                $this->cancelRun((int) $run->id, 'archived');
                $out['cancelled']++;
                continue;
            }
            if ($status !== AutomationStatus::ACTIVE) {
                // Draft or paused: the journey holds. Nobody is sent anything and
                // nobody is dropped — resuming picks up exactly where it stopped.
                $out['held']++;
                continue;
            }

            $out['processed']++;
            try {
                $outcome = $this->advance($automation, $run);
            } catch (\Throwable $error) {
                $this->automations->updateRun((int) $run->id, array(
                    'status' => AutomationRunStatus::FAILED,
                    'last_error' => substr($error->getMessage(), 0, 255),
                ));
                AuditLogger::record('cloudhost247_marketing', 'automation.run_failed', 'marketing_automation', (int) $automation->id,
                    array(), array('run_id' => (int) $run->id), 'failure', $error->getMessage());
                $out['failed']++;
                $out['errors'][] = 'Run #' . (int) $run->id . ': ' . $error->getMessage();
                continue;
            }
            if (isset($out[$outcome])) { $out[$outcome]++; }
        }

        return $out;
    }

    /**
     * One step forward, exactly one.
     *
     * @return string outcome key: messages|waited|completed|cancelled
     */
    private function advance($automation, $run)
    {
        $automationId = (int) $automation->id;
        $position = (int) $run->position;
        $step = $this->automations->stepAt($automationId, $position + 1);

        if (!$step) {
            $this->automations->updateRun((int) $run->id, array(
                'status' => AutomationRunStatus::COMPLETED,
                'completed_at' => date('Y-m-d H:i:s'),
                'next_run_at' => null,
            ));
            AuditLogger::record('cloudhost247_marketing', 'automation.run_completed', 'marketing_automation', $automationId,
                array(), array('run_id' => (int) $run->id, 'messages' => (int) $run->sent_count), 'success');
            return 'completed';
        }

        if (!AutomationStepType::isSending((string) $step->step_type)) {
            $minutes = max(1, (int) $step->wait_minutes);
            $this->automations->updateRun((int) $run->id, array(
                'status' => AutomationRunStatus::WAITING,
                'position' => (int) $step->position,
                'next_run_at' => date('Y-m-d H:i:s', time() + ($minutes * 60)),
            ));
            return 'waited';
        }

        // A send step: is the address still allowed to hear from us?
        $subscriber = $this->subscribers->find((int) $run->subscriber_id);
        if (!$subscriber) {
            $this->cancelRun((int) $run->id, 'subscriber_deleted');
            return 'cancelled';
        }
        $reason = $this->addressability($subscriber);
        if ($reason !== '') {
            $this->cancelRun((int) $run->id, $reason);
            return 'cancelled';
        }

        $content = $this->messageFor($step, $subscriber);
        if ($content === null) {
            throw new \RuntimeException('Step ' . (int) $step->position . ' cannot be sent: ' . $this->lastContentError);
        }

        $containerId = (int) $automation->campaign_id;
        if ($containerId <= 0) { throw new \RuntimeException('The automation has no container campaign; reactivate it.'); }

        $row = $this->queue->enqueue(array(
            'campaign_id' => $containerId,
            'recipient_id' => null,
            'subscriber_id' => (int) $subscriber->id,
            'email' => (string) $subscriber->email,
            'idempotency_key' => 'automation:' . (int) $run->id . ':' . (int) $step->position,
            'provider_key' => (string) $this->settings->get('default_provider'),
            'max_attempts' => max(1, (int) $this->settings->get('retry_attempts')),
            'tracking_token' => bin2hex(random_bytes(16)),
            'next_attempt_at' => date('Y-m-d H:i:s'),
            'scheduled_at' => date('Y-m-d H:i:s'),
            'automation_run_id' => (int) $run->id,
            'automation_step_position' => (int) $step->position,
        ));
        if ($row === null) { throw new \RuntimeException('The message for step ' . (int) $step->position . ' was already queued.'); }

        $this->automations->updateRun((int) $run->id, array(
            'status' => AutomationRunStatus::RUNNING,
            'position' => (int) $step->position,
            'sent_count' => (int) $run->sent_count + 1,
            'next_run_at' => date('Y-m-d H:i:s'),
        ));
        AuditLogger::record('cloudhost247_marketing', 'automation.queued', 'marketing_automation', $automationId,
            array(), array('run_id' => (int) $run->id, 'step' => (int) $step->position, 'queue_id' => (int) $row->id), 'success');
        return 'messages';
    }

    private $lastContentError = '';

    /**
     * The content of one send step for one subscriber, as the tracking composer
     * wants it (subject/html/text/from override). Returns null and sets
     * `lastContentError` when the step cannot be sent.
     */
    public function messageFor($step, $subscriber)
    {
        $this->lastContentError = '';
        if (!AutomationStepType::isSending((string) $step->step_type)) {
            $this->lastContentError = 'that step is not a send step.';
            return null;
        }
        $template = $this->templates->find((int) $step->template_id);
        if (!$template) {
            $this->lastContentError = 'the template was deleted.';
            return null;
        }
        if ((string) $template->status !== 'active') {
            $this->lastContentError = 'the template is archived; reactivate it or point the step at another one.';
            return null;
        }
        $subject = trim((string) $step->subject);
        if ($subject === '') {
            $this->lastContentError = 'the step has no subject line.';
            return null;
        }
        return array(
            'subject' => $subject,
            'html' => (string) $template->html,
            'text' => (string) $template->text,
            'from_name' => trim((string) $step->from_name) !== '' ? (string) $step->from_name : (string) $this->settings->get('default_from_name'),
            'from_email' => trim((string) $step->from_email) !== '' ? (string) $step->from_email : (string) $this->settings->get('default_from_email'),
            'reply_to' => (string) $this->settings->get('default_reply_to'),
        );
    }

    /**
     * The content a queued automation message must be composed with. The queue
     * row froze which run and which step it belongs to, so the message is the
     * step the subscriber was actually at — even if the run has moved on since.
     */
    public function contentForQueueRow($automationRunId, $stepPosition, $subscriber)
    {
        $run = $this->automations->findRun($automationRunId);
        if (!$run) { return null; }
        $step = $this->automations->stepAt((int) $run->automation_id, (int) $stepPosition);
        if (!$step) { return null; }
        return $this->messageFor($step, $subscriber);
    }

    public function contentError() { return $this->lastContentError; }

    // ------------------------------------------------------------------- reads

    /** Everything the Automations screen shows for one journey. */
    public function detail($automationId)
    {
        $automation = $this->automations->find($automationId);
        if (!$automation) { return null; }
        return array(
            'automation' => $automation,
            'steps' => $this->automations->steps((int) $automation->id),
            'runs' => $this->automations->runCounts((int) $automation->id),
            'recent_runs' => $this->automations->recentRuns((int) $automation->id, 25),
            'issues' => $this->activationIssues($automation),
            'container' => (int) $automation->campaign_id > 0 ? $this->campaigns->find((int) $automation->campaign_id) : null,
        );
    }

    public function listAutomations(array $filters = array())
    {
        $page = $this->automations->paginate($filters, isset($filters['page']) ? (int) $filters['page'] : 1, 50);
        $counts = $this->automations->countsByAutomation();
        $rows = array();
        foreach ($page['rows'] as $row) {
            $id = (int) $row->id;
            $rows[] = array(
                'automation' => $row,
                'steps' => count($this->automations->steps($id)),
                'runs' => isset($counts[$id]) ? $counts[$id] : array('running' => 0, 'waiting' => 0, 'completed' => 0, 'cancelled' => 0, 'failed' => 0, 'messages' => 0),
            );
        }
        return array('rows' => $rows, 'page' => $page['page'], 'per_page' => $page['per_page'], 'status_counts' => $this->automations->countByStatus());
    }

    /** Steps of one automation, each with its template name (for the screen). */
    public function stepsWithTemplates($automationId)
    {
        $out = array();
        foreach ($this->automations->steps($automationId) as $step) {
            $name = '';
            if ((int) $step->template_id > 0) {
                $template = $this->templates->find((int) $step->template_id);
                $name = $template ? (string) $template->name : 'Template #' . (int) $step->template_id . ' (deleted)';
            }
            $out[] = array('step' => $step, 'template_name' => $name);
        }
        return $out;
    }

    // ----------------------------------------------------------------- helpers

    private function requireAutomation($id)
    {
        $automation = $this->automations->find($id);
        if (!$automation) { throw new \InvalidArgumentException('That automation does not exist.'); }
        return $automation;
    }

    private function requireUsableTemplate($templateId)
    {
        if ((int) $templateId <= 0) { throw new \InvalidArgumentException('a send step needs a template.'); }
        $template = $this->templates->find((int) $templateId);
        if (!$template) { throw new \InvalidArgumentException('that template does not exist.'); }
        if ((string) $template->status !== 'active') { throw new \InvalidArgumentException('that template is archived.'); }
        return (int) $template->id;
    }

    private function normaliseTrigger($type, $listId)
    {
        $type = (string) $type;
        if (!AutomationTrigger::isValid($type)) { throw new \InvalidArgumentException('Choose a trigger.'); }
        if (AutomationTrigger::requiresList($type) && (int) $listId <= 0) {
            throw new \InvalidArgumentException('Choose the list whose new members start this journey.');
        }
        return $type;
    }

    private function normaliseDelay($minutes)
    {
        $minutes = (int) $minutes;
        if ($minutes < 0 || $minutes > self::MAX_TRIGGER_DELAY_MINUTES) {
            throw new \InvalidArgumentException('The trigger delay must be between 0 and ' . self::MAX_TRIGGER_DELAY_MINUTES . ' minutes.');
        }
        return $minutes;
    }

    private function normaliseWait($minutes)
    {
        $minutes = (int) $minutes;
        if ($minutes < 1 || $minutes > self::MAX_WAIT_MINUTES) {
            throw new \InvalidArgumentException('A wait must be between 1 and ' . self::MAX_WAIT_MINUTES . ' minutes.');
        }
        return $minutes;
    }

    /**
     * Why this subscriber must not be enrolled or advanced, or '' when they may.
     * The same conditions the delivery pass applies, checked before a message is
     * ever queued so a journey cannot fill the queue with undeliverable mail.
     */
    private function addressability($subscriber)
    {
        if ((string) $subscriber->status === SubscriberStatus::UNSUBSCRIBED) { return 'unsubscribed'; }
        if ((string) $subscriber->status === SubscriberStatus::SUPPRESSED) { return 'suppressed'; }
        if ((string) $subscriber->status !== SubscriberStatus::SUBSCRIBED) { return 'not_subscribed'; }
        if ((string) $subscriber->consent_status === ConsentStatus::REVOKED) { return 'consent_revoked'; }
        if ($this->suppressions->isSuppressed((string) $subscriber->email)) { return 'suppressed'; }
        return '';
    }

    private function enrolmentKey($automation, $subscriberId)
    {
        $base = 'a' . (int) $automation->id . ':s' . (int) $subscriberId;
        if (empty($automation->reenrollable)) { return $base; }
        // Each finished journey keeps its own key, so a retried trigger recomputes
        // the same next number and cannot start two runs for one enrolment.
        $sequence = 1;
        while ($this->automations->findRunByKey($base . ':' . $sequence)) { $sequence++; }
        return $base . ':' . $sequence;
    }
}
