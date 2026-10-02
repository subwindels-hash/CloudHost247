<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Domain\EventType;
use WHMCS\Database\Capsule;

/**
 * The insert-only tracking ledger (requirement #23, #26).
 *
 * Every row is one thing that really happened to one message: queued, accepted
 * by the relay, opened, clicked, unsubscribed, bounced. Nothing else may write
 * here, and analytics (SESSION 9) reads only from here — which is what keeps a
 * report honest, because a rate is then a count of recorded events, never an
 * estimate.
 *
 * `meta_json` is deliberately narrow: kinds, link ids and token-derived
 * references only. No message bodies, no headers, no recipient-supplied text.
 */
final class EventRepository
{
    const TABLE = 'mod_cloudhost247_marketing_email_events';

    public function record($type, $campaignId, $queueId, $subscriberId, array $meta = array())
    {
        if (!EventType::isValid($type)) {
            throw new \InvalidArgumentException('Unknown event type: ' . (string) $type);
        }
        $clean = array();
        foreach ($meta as $key => $value) {
            if (!is_scalar($value) || $value === '') { continue; }
            $key = preg_replace('/[^a-z0-9_]/', '', strtolower((string) $key));
            if ($key === '') { continue; }
            $clean[substr($key, 0, 32)] = substr((string) $value, 0, 190);
        }
        return Capsule::table(self::TABLE)->insertGetId(array(
            'campaign_id' => $campaignId === null ? null : (int) $campaignId,
            'queue_id' => $queueId === null ? null : (int) $queueId,
            'subscriber_id' => $subscriberId === null ? null : (int) $subscriberId,
            'type' => (string) $type,
            'meta_json' => $clean ? json_encode($clean) : null,
            'occurred_at' => date('Y-m-d H:i:s'),
        ));
    }

    /** Has this exact thing already been recorded for this message? (open/click dedupe) */
    public function exists($type, $queueId, array $meta = array())
    {
        $rows = Capsule::table(self::TABLE)
            ->where('type', (string) $type)
            ->where('queue_id', (int) $queueId)
            ->get();
        foreach ($rows ? $rows->all() : array() as $row) {
            if ($meta === array()) { return true; }
            $stored = array();
            if (!empty($row->meta_json)) {
                $decoded = json_decode((string) $row->meta_json, true);
                if (is_array($decoded)) { $stored = $decoded; }
            }
            $matches = true;
            foreach ($meta as $key => $value) {
                if (!isset($stored[$key]) || (string) $stored[$key] !== (string) $value) { $matches = false; break; }
            }
            if ($matches) { return true; }
        }
        return false;
    }

    public function countsFor($campaignId, $type = null)
    {
        $query = Capsule::table(self::TABLE)->where('campaign_id', (int) $campaignId);
        if ($type !== null) { $query->where('type', (string) $type); }
        $row = $query->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    public function countByType($campaignId)
    {
        $counts = array();
        foreach (EventType::all() as $type) { $counts[$type] = 0; }
        foreach (Capsule::table(self::TABLE)->where('campaign_id', (int) $campaignId)->get()->all() as $row) {
            $type = (string) $row->type;
            if (isset($counts[$type])) { $counts[$type]++; }
        }
        return $counts;
    }

    /** Recent events for one campaign, newest first (admin timeline). */
    public function recentFor($campaignId, $limit = 25)
    {
        $rows = Capsule::table(self::TABLE)
            ->where('campaign_id', (int) $campaignId)
            ->orderBy('occurred_at', 'desc')
            ->limit(max(1, (int) $limit))
            ->get();
        return $rows ? $rows->all() : array();
    }

    /**
     * Trims the ledger to the retention window (requirement #27) and returns the
     * number of rows removed. Called by the worker, never by a web request.
     */
    public function prune($days)
    {
        $days = max(1, (int) $days);
        $cutoff = date('Y-m-d H:i:s', time() - ($days * 86400));
        $rows = Capsule::table(self::TABLE)->where('occurred_at', '<', $cutoff)->get();
        $removed = 0;
        foreach ($rows ? $rows->all() : array() as $row) {
            Capsule::table(self::TABLE)->where('id', (int) $row->id)->delete();
            $removed++;
        }
        return $removed;
    }
}
