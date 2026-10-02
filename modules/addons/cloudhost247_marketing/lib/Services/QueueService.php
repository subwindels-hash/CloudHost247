<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Marketing\Domain\CampaignAudience;
use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\EventRepository;
use CloudHost247\Marketing\Repositories\QueueRepository;
use CloudHost247\Marketing\Repositories\RecipientRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\SuppressionRepository;
use CloudHost247\Marketing\Security\InputValidator;

/**
 * The delivery worker's brain (requirement #23, #24, #25, #29).
 *
 * One run does four things, in this order, and every step is idempotent:
 *
 *   1. `materialize()` freezes the audience: the segment or list is resolved once
 *      and stored as recipient rows. Suppressed and unsubscribed addresses are
 *      dropped here, with the reason recorded.
 *   2. `enqueue()` turns pending recipients into queue rows, keyed so a re-run
 *      cannot create a second message for the same person.
 *   3. `dispatch()` claims due rows, sends them through the configured
 *      `MessageTransport`, and records what actually happened. A permanent
 *      refusal suppresses the address; a transient failure is retried with the
 *      configured backoff; a relay that refuses to authenticate stops the run
 *      instead of burning through the whole audience.
 *   4. `settle()` closes campaigns whose queue has drained — and reports a
 *      campaign as failed rather than completed when nothing got out.
 *
 * Throttling is expressed as an allowance for one run (batch size, per-minute
 * ceiling, rolling hourly ceiling). The worker never sleeps inside a request; a
 * smaller allowance simply means the next cron run picks up the remainder.
 */
final class QueueService
{
    const WORKER_BATCH = 200;

    private $campaigns;
    private $campaignService;
    private $queue;
    private $recipients;
    private $subscribers;
    private $suppressions;
    private $subscriptions;
    private $settings;
    private $trackingService;

    public function __construct(
        CampaignRepository $campaigns = null,
        CampaignService $campaignService = null,
        QueueRepository $queue = null,
        RecipientRepository $recipients = null,
        SubscriberRepository $subscribers = null,
        SuppressionRepository $suppressions = null,
        SubscriptionService $subscriptions = null,
        SettingsRepository $settings = null
    ) {
        $this->campaigns = $campaigns ?: new CampaignRepository();
        $this->campaignService = $campaignService ?: new CampaignService();
        $this->queue = $queue ?: new QueueRepository();
        $this->recipients = $recipients ?: new RecipientRepository();
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->suppressions = $suppressions ?: new SuppressionRepository();
        $this->subscriptions = $subscriptions ?: new SubscriptionService();
        $this->settings = $settings ?: new SettingsRepository();
    }

    public function repository()
    {
        return $this->queue;
    }

    /** Lazily built so a worker run pays for tracking only when it sends. */
    private function tracking()
    {
        if ($this->trackingService === null) { $this->trackingService = new TrackingService(); }
        return $this->trackingService;
    }

    public function recipients()
    {
        return $this->recipients;
    }

    /**
     * Runs one worker pass.
     *
     * @param array $options worker (worker id), campaign_id (only this campaign),
     *                       dry_run (resolve and enqueue, never send)
     * @return array summary counters for the cron output
     */
    public function run(array $options = array())
    {
        $workerId = isset($options['worker']) ? (string) $options['worker'] : 'cron-' . getmypid();
        $onlyCampaign = isset($options['campaign_id']) ? (int) $options['campaign_id'] : 0;
        $dryRun = !empty($options['dry_run']);
        $summary = array(
            'worker' => $workerId,
            'disabled' => false,
            'campaigns' => 0,
            'recipients' => 0,
            'skipped_addresses' => 0,
            'enqueued' => 0,
            'claimed' => 0,
            'sent' => 0,
            'retried' => 0,
            'failed' => 0,
            'suppressed' => 0,
            'released_locks' => 0,
            'completed' => 0,
            'pruned_events' => 0,
            'campaign_errors' => array(),
            'rate_limited' => '',
        );

        if ((string) $this->settings->get('enabled') !== '1') {
            $summary['disabled'] = true;
            return $summary;
        }

        $summary['released_locks'] = $this->queue->releaseStaleLocks();

        $campaigns = array();
        if ($onlyCampaign > 0) {
            $campaign = $this->campaigns->find($onlyCampaign);
            if ($campaign) { $campaigns[] = $campaign; }
        } else {
            foreach ($this->campaigns->due(date('Y-m-d H:i:s'), 10) as $campaign) { $campaigns[] = $campaign; }
        }

        // Campaigns already queueing but not finished (for example after a pause
        // was lifted or a previous run hit the rate ceiling) continue here.
        foreach ($this->campaigns->paginate(array('status' => CampaignStatus::QUEUED), 1, self::WORKER_BATCH)['rows'] as $campaign) {
            $seen = false;
            foreach ($campaigns as $open) { if ((int) $open->id === (int) $campaign->id) { $seen = true; break; } }
            if (!$seen) { $campaigns[] = $campaign; }
        }

        foreach ($campaigns as $campaign) {
            $summary['campaigns']++;
            try {
                $materialized = $this->materialize((int) $campaign->id);
                $summary['recipients'] += $materialized['recipients'];
                $summary['skipped_addresses'] += $materialized['skipped'];
                $summary['enqueued'] += $this->enqueue((int) $campaign->id);
            } catch (\Throwable $error) {
                $summary['campaign_errors'][] = $campaign->name . ': ' . $error->getMessage();
                $this->campaigns->setStatus((int) $campaign->id, CampaignStatus::FAILED, array(
                    'failed_at' => date('Y-m-d H:i:s'),
                    'failure_reason' => $error->getMessage(),
                ));
                AuditLogger::record('cloudhost247_marketing', 'campaign.failed', 'marketing_campaign', (int) $campaign->id,
                    array('status' => (string) $campaign->status), array('reason' => $error->getMessage()), 'failure', $error->getMessage());
            }
        }

        if ($dryRun) {
            $summary['rate_limited'] = 'dry run: nothing was sent';
            return $summary;
        }

        $allowance = $this->allowance();
        if ($allowance <= 0) {
            $summary['rate_limited'] = 'hourly limit reached (' . (int) $this->settings->get('hourly_limit') . ')';
        } else {
            $dispatch = $this->dispatch($workerId, $allowance, $onlyCampaign);
            $summary['claimed'] += $dispatch['claimed'];
            $summary['sent'] += $dispatch['sent'];
            $summary['retried'] += $dispatch['retried'];
            $summary['failed'] += $dispatch['failed'];
            $summary['suppressed'] += $dispatch['suppressed'];
            if ($dispatch['stopped'] !== '') { $summary['rate_limited'] = $dispatch['stopped']; }
        }

        $settle = $this->settle($onlyCampaign);
        $summary['completed'] += $settle['completed'];
        foreach ($settle['errors'] as $message) { $summary['campaign_errors'][] = $message; }

        // Retention is part of the worker's job (requirement #27): the ledger is
        // trimmed here, never during a web request.
        $summary['pruned_events'] = $this->pruneEvents();

        return $summary;
    }

    /** Trims the tracking ledger to the configured retention window. */
    public function pruneEvents()
    {
        return (new EventRepository())->prune((int) $this->settings->get('events_retention_days'));
    }

    /** How many messages this run may attempt, from settings. */
    public function allowance()
    {
        $batch = max(1, (int) $this->settings->get('batch_size'));
        $perMinute = max(1, (int) $this->settings->get('messages_per_minute'));
        $hourly = max(1, (int) $this->settings->get('hourly_limit'));
        $sentThisHour = $this->queue->sentSince(date('Y-m-d H:i:s', time() - 3600));
        $hourlyRemaining = max(0, $hourly - $sentThisHour);
        return (int) max(0, min($batch, $perMinute, $hourlyRemaining));
    }

    /**
     * Freezes the audience of one campaign into recipient rows.
     *
     * @return array{recipients:int,skipped:int,reasons:array<string,int>}
     */
    public function materialize($campaignId)
    {
        $campaign = $this->requireCampaign($campaignId);
        if (CampaignStatus::isTerminal((string) $campaign->status) && (string) $campaign->status !== CampaignStatus::FAILED) {
            throw new \RuntimeException('A campaign in "' . CampaignStatus::label($campaign->status) . '" is not queued for delivery.');
        }

        $this->campaigns->setStatus((int) $campaign->id, CampaignStatus::QUEUED);

        $result = array('recipients' => 0, 'skipped' => 0, 'reasons' => array());
        foreach ($this->audience($campaign) as $subscriber) {
            $email = strtolower(trim((string) $subscriber->email));
            if ($email === '' || !InputValidator::isPlausibleEmail($email)) {
                $result['skipped']++;
                $this->bump($result['reasons'], 'invalid_address');
                continue;
            }
            if ((string) $subscriber->status !== SubscriberStatus::SUBSCRIBED) {
                $result['skipped']++;
                $this->bump($result['reasons'], 'status_' . (string) $subscriber->status);
                continue;
            }
            if ($this->suppressions->isSuppressed($email)) {
                $result['skipped']++;
                $this->bump($result['reasons'], 'suppressed');
                continue;
            }
            $rowId = $this->recipients->add((int) $campaign->id, (int) $subscriber->id, $email, $this->recipients->personalisation($subscriber));
            if ($rowId === null) { continue; } // already frozen for this campaign
            $result['recipients']++;
        }

        if ($result['recipients'] > 0 || (string) $campaign->status === CampaignStatus::QUEUED) {
            AuditLogger::record('cloudhost247_marketing', 'campaign.materialized', 'marketing_campaign', (int) $campaign->id,
                array(), array(
                    'recipients' => $result['recipients'],
                    'skipped' => $result['skipped'],
                    'reasons' => $result['reasons'],
                ), 'success');
        }
        return $result;
    }

    /** Creates queue rows for pending recipients. Re-runs are no-ops. */
    public function enqueue($campaignId)
    {
        $campaign = $this->requireCampaign($campaignId);
        if ((string) $campaign->status === CampaignStatus::PAUSED || (string) $campaign->status === CampaignStatus::CANCELLED) {
            return 0;
        }
        $maxAttempts = max(1, (int) $this->settings->get('retry_attempts'));
        $now = date('Y-m-d H:i:s');
        $created = 0;

        foreach ($this->recipients->pending((int) $campaign->id, self::WORKER_BATCH) as $recipient) {
            $row = $this->queue->enqueue(array(
                'campaign_id' => (int) $campaign->id,
                'recipient_id' => (int) $recipient->id,
                'subscriber_id' => $recipient->subscriber_id === null ? null : (int) $recipient->subscriber_id,
                'email' => (string) $recipient->email,
                'idempotency_key' => $this->idempotencyKey((int) $campaign->id, (int) $recipient->id),
                'provider_key' => $this->campaignService->transport()->key(),
                'max_attempts' => $maxAttempts,
                'tracking_token' => bin2hex(random_bytes(16)),
                'next_attempt_at' => $now,
                'scheduled_at' => $now,
            ));
            if ($row === null) { continue; }
            $created++;
            $this->queue->recordEvent('queued', (int) $campaign->id, (int) $row->id,
                $recipient->subscriber_id === null ? null : (int) $recipient->subscriber_id, array());
        }

        if ($created > 0) {
            AuditLogger::record('cloudhost247_marketing', 'campaign.queue_filled', 'marketing_campaign', (int) $campaign->id,
                array(), array('queued' => $created), 'success');
        }
        return $created;
    }

    /**
     * Claims and delivers up to $limit messages.
     *
     * @return array{claimed:int,sent:int,retried:int,failed:int,suppressed:int,stopped:string}
     */
    public function dispatch($workerId, $limit, $onlyCampaign = 0)
    {
        $result = array('claimed' => 0, 'sent' => 0, 'retried' => 0, 'failed' => 0, 'suppressed' => 0, 'stopped' => '');
        $transport = $this->campaignService->transport();
        $softThreshold = max(1, (int) $this->settings->get('bounce_soft_threshold'));

        if (!$transport->isAvailable()) {
            $result['stopped'] = 'no delivery provider: ' . $transport->reason();
            return $result;
        }

        $claimed = $this->queue->claim($workerId, min($limit, self::WORKER_BATCH), (int) $this->settings->get('queue_lock_seconds'));
        foreach ($claimed as $index => $row) {
            $result['claimed']++;
            $campaign = $this->campaigns->find((int) $row->campaign_id);
            // A pause is temporary: the message goes back to the queue without
            // spending a retry. A cancel or an archive is final: it is skipped.
            if ($campaign && (string) $campaign->status === CampaignStatus::PAUSED) {
                $this->queue->release((int) $row->id, 'campaign_paused',
                    'The campaign is paused; this message waits for a resume.',
                    date('Y-m-d H:i:s'));
                continue;
            }
            if (!$campaign || in_array((string) $campaign->status, array(CampaignStatus::CANCELLED, CampaignStatus::ARCHIVED), true)) {
                $this->queue->markSkipped((int) $row->id, 'campaign_' . ($campaign ? (string) $campaign->status : 'missing'));
                $this->queue->recordEvent('skipped', (int) $row->campaign_id, (int) $row->id, $row->subscriber_id, array('reason' => 'campaign_closed'));
                if ($row->recipient_id !== null) { $this->recipients->markSkipped((int) $row->recipient_id, 'campaign closed'); }
                continue;
            }

            // Re-check the two rules that must never be bypassed by a queue row
            // that was created earlier: suppression and unsubscribe.
            if ($this->suppressions->isSuppressed((string) $row->email)) {
                $this->queue->markSkipped((int) $row->id, 'suppressed');
                $this->queue->recordEvent('skipped', (int) $row->campaign_id, (int) $row->id, $row->subscriber_id, array('reason' => 'suppressed'));
                if ($row->recipient_id !== null) { $this->recipients->markSkipped((int) $row->recipient_id, 'suppressed'); }
                continue;
            }

            // TrackingService composes the real message: personalisation, the
            // campaign's own links rewritten to click URLs, the open pixel and the
            // unsubscribe footer. A test send uses composeTest() instead, which
            // carries no token.
            $subscriber = $row->subscriber_id === null ? null : $this->subscribers->find((int) $row->subscriber_id);
            $message = $this->tracking()->compose($campaign, $row, $subscriber);

            $outcome = $transport->send($message);
            if (!empty($outcome['ok'])) {
                $this->queue->markSent((int) $row->id, isset($outcome['provider_message_id']) ? (string) $outcome['provider_message_id'] : '');
                $this->queue->recordEvent('sent', (int) $row->campaign_id, (int) $row->id, $row->subscriber_id, array());
                if ($row->recipient_id !== null) { $this->recipients->markSent((int) $row->recipient_id); }
                $result['sent']++;
                continue;
            }

            $code = isset($outcome['code']) ? (string) $outcome['code'] : 'provider_unavailable';
            $error = isset($outcome['error']) ? (string) $outcome['error'] : 'The provider refused the message.';

            // A provider that cannot authenticate or is misconfigured is not a
            // per-message problem: stop the run so the operator sees it once.
            if (in_array($code, array('authentication_failed', 'invalid_configuration', 'invalid_endpoint'), true)) {
                $this->queue->markFailed((int) $row->id, $code, $error, $this->retryAt((int) $row->attempts, (int) $row->max_attempts));
                $this->queue->recordEvent('failed', (int) $row->campaign_id, (int) $row->id, $row->subscriber_id, array('kind' => $code));
                // Messages claimed after this one were never attempted: hand them
                // straight back so a broken relay cannot hold the whole batch.
                $this->releaseUnattempted($claimed, $index + 1);
                $result['stopped'] = 'provider refused the session: ' . $error;
                break;
            }

            if ($code === 'permission_denied') {
                // Permanent refusal of this recipient: suppress the address.
                $this->queue->markFailed((int) $row->id, 'hard_bounce', $error, null);
                $this->queue->recordEvent('bounced', (int) $row->campaign_id, (int) $row->id, $row->subscriber_id, array('kind' => 'hard'));
                if ($row->recipient_id !== null) { $this->recipients->markFailed((int) $row->recipient_id, 'hard bounce'); }
                $this->subscriptions->recordBounce((string) $row->email, 'hard', $softThreshold);
                $result['suppressed']++;
                $result['failed']++;
                continue;
            }

            $retryAt = $this->retryAt((int) $row->attempts, (int) $row->max_attempts);
            if ($retryAt !== null) {
                $this->queue->markFailed((int) $row->id, $code === '' ? 'transient' : $code, $error, $retryAt);
                $this->queue->recordEvent('failed', (int) $row->campaign_id, (int) $row->id, $row->subscriber_id, array('kind' => $code, 'retry_at' => $retryAt));
                $result['retried']++;
                continue;
            }

            $this->queue->markFailed((int) $row->id, 'exhausted', $error, null);
            $this->queue->recordEvent('failed', (int) $campaign->id, (int) $row->id, $row->subscriber_id, array('kind' => 'exhausted'));
            if ($row->recipient_id !== null) { $this->recipients->markFailed((int) $row->recipient_id, 'retries exhausted'); }
            $this->subscriptions->recordBounce((string) $row->email, 'soft', $softThreshold);
            $result['failed']++;
        }

        return $result;
    }

    /** Returns claimed-but-unattempted rows to the queue without spending a retry. */
    private function releaseUnattempted(array $claimed, $from)
    {
        for ($index = $from; $index < count($claimed); $index++) {
            $this->queue->release((int) $claimed[$index]->id, 'not_attempted',
                'The run stopped before this message was attempted.', date('Y-m-d H:i:s'));
        }
    }

    /** Closes campaigns whose queue has drained; reports the honest outcome. */
    public function settle($onlyCampaign = 0)
    {
        $out = array('completed' => 0, 'errors' => array());
        $open = array();
        if ($onlyCampaign > 0) {
            $campaign = $this->campaigns->find($onlyCampaign);
            if ($campaign) { $open[] = $campaign; }
        } else {
            foreach ($this->campaigns->paginate(array('status' => CampaignStatus::QUEUED), 1, self::WORKER_BATCH)['rows'] as $campaign) { $open[] = $campaign; }
        }

        foreach ($open as $campaign) {
            $unfinished = $this->queue->unfinishedForCampaign((int) $campaign->id);
            $recipientsPending = $this->recipients->count((int) $campaign->id, RecipientRepository::STATUS_PENDING);
            if ($unfinished > 0 || $recipientsPending > 0) { continue; }

            $sent = $this->queue->sentForCampaign((int) $campaign->id);
            $failed = $this->queue->failedForCampaign((int) $campaign->id);
            if ($sent === 0 && $failed > 0) {
                $this->campaigns->setStatus((int) $campaign->id, CampaignStatus::FAILED, array(
                    'failed_at' => date('Y-m-d H:i:s'),
                    'failure_reason' => 'Every queued message failed.',
                ));
                AuditLogger::record('cloudhost247_marketing', 'campaign.failed', 'marketing_campaign', (int) $campaign->id,
                    array('status' => CampaignStatus::QUEUED), array('sent' => 0, 'failed' => $failed), 'failure', 'Every queued message failed.');
                continue;
            }

            $this->campaigns->setStatus((int) $campaign->id, CampaignStatus::COMPLETED, array(
                'completed_at' => date('Y-m-d H:i:s'),
                'failure_reason' => $failed > 0 ? $failed . ' message(s) failed.' : '',
            ));
            AuditLogger::record('cloudhost247_marketing', 'campaign.completed', 'marketing_campaign', (int) $campaign->id,
                array('status' => CampaignStatus::QUEUED), array('sent' => $sent, 'failed' => $failed), $failed > 0 ? 'partial' : 'success');
            $out['completed']++;
        }
        return $out;
    }

    /** @return object[] subscribers addressed by this campaign's audience */
    private function audience($campaign)
    {
        $type = (string) $campaign->audience_type;
        if ($type === CampaignAudience::ALL) {
            return $this->subscribers->collect(array('status' => SubscriberStatus::SUBSCRIBED), self::WORKER_BATCH * 100);
        }
        if ($type === CampaignAudience::LIST) {
            return $this->subscribers->collect(array(
                'list_id' => (int) $campaign->audience_id,
                'status' => SubscriberStatus::SUBSCRIBED,
            ), self::WORKER_BATCH * 100);
        }
        if ($type === CampaignAudience::SEGMENT) {
            $ids = $this->campaignService->segmentIds((int) $campaign->audience_id, self::WORKER_BATCH * 100);
            $rows = array();
            foreach ($ids as $id) {
                $subscriber = $this->subscribers->find((int) $id);
                if ($subscriber) { $rows[] = $subscriber; }
            }
            return $rows;
        }
        throw new \RuntimeException('This campaign has no usable audience type.');
    }

    private function idempotencyKey($campaignId, $recipientId)
    {
        return 'q-' . substr(hash('sha256', 'cloudhost247-marketing:' . $campaignId . ':' . $recipientId), 0, 40);
    }

    /** Backoff schedule from settings; null when the attempts are exhausted. */
    private function retryAt($attempts, $maxAttempts)
    {
        if ($attempts >= $maxAttempts) { return null; }
        $schedule = array();
        foreach (preg_split('/\s*,\s*/', (string) $this->settings->get('retry_backoff_minutes')) as $step) {
            if ($step !== '' && is_numeric($step)) { $schedule[] = max(0, (int) $step); }
        }
        if (!$schedule) { $schedule = array(5, 30, 120); }
        $index = min(max(0, $attempts - 1), count($schedule) - 1);
        return date('Y-m-d H:i:s', time() + $schedule[$index] * 60);
    }

    private function bump(array &$counts, $key)
    {
        $counts[$key] = isset($counts[$key]) ? $counts[$key] + 1 : 1;
    }

    private function requireCampaign($id)
    {
        $campaign = $this->campaigns->find((int) $id);
        if (!$campaign) { throw new \InvalidArgumentException('Unknown campaign.'); }
        return $campaign;
    }
}
