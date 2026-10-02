<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Repositories\EventRepository;
use WHMCS\Database\Capsule;

/**
 * The delivery queue (requirement #23, #24).
 *
 * One row per message, claimed by exactly one worker. Claiming is a two-step
 * update guarded by `locked_until`: a worker only picks rows that are queued,
 * due, and not locked by somebody else, then immediately stamps its own lock.
 * A worker that dies mid-send leaves the lock behind, and `releaseStaleLocks()`
 * returns those rows to the queue — which is why a crashed cron degrades into
 * "sends later", never into "message lost" or "message sent twice".
 */
final class QueueRepository
{
    const TABLE = 'mod_cloudhost247_marketing_email_queue';
    const EVENTS_TABLE = 'mod_cloudhost247_marketing_email_events';

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByTrackingToken($token)
    {
        $token = strtolower(trim((string) $token));
        if ($token === '') { return null; }
        return Capsule::table(self::TABLE)->where('tracking_token', $token)->first();
    }

    public function findByIdempotencyKey($key)
    {
        return Capsule::table(self::TABLE)->where('idempotency_key', (string) $key)->first();
    }

    /** Inserts one queue row; the unique idempotency key makes re-runs a no-op. */
    public function enqueue(array $row)
    {
        $key = (string) $row['idempotency_key'];
        if ($this->findByIdempotencyKey($key)) { return null; }
        $now = date('Y-m-d H:i:s');
        $id = Capsule::table(self::TABLE)->insertGetId(array(
            'campaign_id' => (int) $row['campaign_id'],
            'recipient_id' => isset($row['recipient_id']) ? (int) $row['recipient_id'] : null,
            'subscriber_id' => isset($row['subscriber_id']) ? (int) $row['subscriber_id'] : null,
            'email' => (string) $row['email'],
            'idempotency_key' => $key,
            'provider_key' => isset($row['provider_key']) ? substr((string) $row['provider_key'], 0, 32) : 'cpanel_smtp',
            'status' => QueueStatus::QUEUED,
            'attempts' => 0,
            'max_attempts' => max(1, (int) $row['max_attempts']),
            'next_attempt_at' => isset($row['next_attempt_at']) ? $row['next_attempt_at'] : $now,
            'locked_until' => null,
            'locked_by' => '',
            'tracking_token' => (string) $row['tracking_token'],
            // 0 for campaign messages; an automation run otherwise (SESSION 10).
            'automation_run_id' => isset($row['automation_run_id']) ? (int) $row['automation_run_id'] : 0,
            'automation_step_position' => isset($row['automation_step_position']) ? (int) $row['automation_step_position'] : 0,
            'message_id' => '',
            'sent_at' => null,
            'failed_at' => null,
            'last_error_kind' => '',
            'last_error' => '',
            'scheduled_at' => isset($row['scheduled_at']) ? $row['scheduled_at'] : $now,
            'created_at' => $now,
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    /**
     * Claims up to $limit due rows for one worker.
     *
     * The candidate read is followed by a conditional update: if another worker
     * claimed the row in between, `update()` affects zero rows and it is skipped.
     *
     * @return array[] the rows this worker now owns
     */
    public function claim($workerId, $limit, $lockSeconds)
    {
        $now = date('Y-m-d H:i:s');
        $lockUntil = date('Y-m-d H:i:s', time() + max(30, (int) $lockSeconds));
        $candidates = Capsule::table(self::TABLE)
            ->where('status', QueueStatus::QUEUED)
            ->where('next_attempt_at', '<=', $now)
            ->orderBy('next_attempt_at', 'asc')
            ->orderBy('id', 'asc')
            ->limit(max(1, (int) $limit))
            ->get();

        $claimed = array();
        foreach ($candidates ? $candidates->all() : array() as $row) {
            $affected = Capsule::table(self::TABLE)
                ->where('id', (int) $row->id)
                ->where('status', QueueStatus::QUEUED)
                ->where('locked_until', '<', $now) // NULL never matches; see below
                ->update(array(
                    'status' => QueueStatus::SENDING,
                    'locked_until' => $lockUntil,
                    'locked_by' => substr((string) $workerId, 0, 64),
                    'attempts' => (int) $row->attempts + 1,
                    'updated_at' => $now,
                ));
            if ($affected < 1 && $row->locked_until === null) {
                // A row that has never been locked is claimed the same way; the
                // comparison above is only used to keep stale locks out.
                $affected = Capsule::table(self::TABLE)
                    ->where('id', (int) $row->id)
                    ->where('status', QueueStatus::QUEUED)
                    ->update(array(
                        'status' => QueueStatus::SENDING,
                        'locked_until' => $lockUntil,
                        'locked_by' => substr((string) $workerId, 0, 64),
                        'attempts' => (int) $row->attempts + 1,
                        'updated_at' => $now,
                    ));
            }
            if ($affected > 0) {
                $claimed[] = $this->find((int) $row->id);
            }
        }
        return $claimed;
    }

    /** Returns rows whose worker died mid-flight to the queue. */
    public function releaseStaleLocks($now = null)
    {
        $now = $now === null ? date('Y-m-d H:i:s') : (string) $now;
        $stale = Capsule::table(self::TABLE)
            ->where('status', QueueStatus::SENDING)
            ->where('locked_until', '<=', $now)
            ->get();
        $released = 0;
        foreach ($stale ? $stale->all() : array() as $row) {
            Capsule::table(self::TABLE)->where('id', (int) $row->id)->update(array(
                'status' => QueueStatus::QUEUED,
                'locked_until' => null,
                'locked_by' => '',
                'last_error_kind' => 'stale_lock',
                'last_error' => 'The previous worker did not finish this message; it was returned to the queue.',
                'updated_at' => $now,
            ));
            $released++;
        }
        return $released;
    }

    public function markSent($id, $messageId = '')
    {
        $now = date('Y-m-d H:i:s');
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array(
            'status' => QueueStatus::SENT,
            'message_id' => substr((string) $messageId, 0, 255),
            'sent_at' => $now,
            'locked_until' => null,
            'locked_by' => '',
            'last_error_kind' => '',
            'last_error' => '',
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    public function markFailed($id, $kind, $error, $retryAt = null)
    {
        $now = date('Y-m-d H:i:s');
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array(
            'status' => $retryAt === null ? QueueStatus::FAILED : QueueStatus::QUEUED,
            'failed_at' => $retryAt === null ? $now : null,
            'next_attempt_at' => $retryAt === null ? null : (string) $retryAt,
            'locked_until' => null,
            'locked_by' => '',
            'last_error_kind' => substr((string) $kind, 0, 32),
            'last_error' => substr((string) $error, 0, 255),
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    /**
     * Puts a claimed row back in the queue without spending a retry: used while a
     * campaign is paused, where the message is neither delivered nor finished.
     */
    public function release($id, $kind, $error, $retryAt)
    {
        $row = $this->find($id);
        if (!$row) { throw new \InvalidArgumentException('Unknown queue row.'); }
        $now = date('Y-m-d H:i:s');
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array(
            'status' => QueueStatus::QUEUED,
            'attempts' => max(0, (int) $row->attempts - 1),
            'next_attempt_at' => (string) $retryAt,
            'locked_until' => null,
            'locked_by' => '',
            'last_error_kind' => substr((string) $kind, 0, 32),
            'last_error' => substr((string) $error, 0, 255),
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    public function markSkipped($id, $reason)
    {
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array(
            'status' => QueueStatus::SKIPPED,
            'locked_until' => null,
            'locked_by' => '',
            'last_error_kind' => 'skipped',
            'last_error' => substr((string) $reason, 0, 255),
            'updated_at' => date('Y-m-d H:i:s'),
        ));
        return $this->find($id);
    }

    public function countsForCampaign($campaignId)
    {
        $counts = array();
        foreach (QueueStatus::all() as $status) { $counts[$status] = 0; }
        foreach (Capsule::table(self::TABLE)->where('campaign_id', (int) $campaignId)->get()->all() as $row) {
            $status = (string) $row->status;
            if (isset($counts[$status])) { $counts[$status]++; }
        }
        return $counts;
    }

    public function counts()
    {
        $query = Capsule::table(self::TABLE);
        $counts = array();
        foreach (QueueStatus::all() as $status) {
            $row = Capsule::table(self::TABLE)->where('status', $status)->selectRaw('COUNT(*) AS aggregate')->first();
            $counts[$status] = $row ? (int) $row->aggregate : 0;
        }
        return $counts;
    }

    /** Messages accepted by the relay inside the rolling hour (rate limiting). */
    public function sentSince($since)
    {
        $row = Capsule::table(self::TABLE)->where('status', QueueStatus::SENT)->where('sent_at', '>=', (string) $since)->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    /** Rows still waiting to be attempted for one campaign. */
    public function pendingForCampaign($campaignId)
    {
        $rows = Capsule::table(self::TABLE)
            ->where('campaign_id', (int) $campaignId)
            ->where('status', QueueStatus::QUEUED)
            ->limit(1000)
            ->get();
        return $rows ? $rows->all() : array();
    }

    public function unfinishedForCampaign($campaignId)
    {
        $counts = $this->countsForCampaign($campaignId);
        return (int) $counts[QueueStatus::QUEUED] + (int) $counts[QueueStatus::SENDING];
    }

    public function failedForCampaign($campaignId)
    {
        $counts = $this->countsForCampaign($campaignId);
        return (int) $counts[QueueStatus::FAILED];
    }

    public function sentForCampaign($campaignId)
    {
        $counts = $this->countsForCampaign($campaignId);
        return (int) $counts[QueueStatus::SENT];
    }

    /**
     * Appends one event to the ledger. The ledger is the single source of truth
     * for analytics, so it stores classifications and identifiers — never a
     * message body, a payload or anything a recipient wrote.
     */
    public function recordEvent($type, $campaignId, $queueId, $subscriberId, array $meta = array())
    {
        // The ledger has exactly one writer: EventRepository. This method stays
        // as the queue-side shorthand used by the worker.
        return (new EventRepository())->record($type, $campaignId, $queueId, $subscriberId, $meta);
    }
}
