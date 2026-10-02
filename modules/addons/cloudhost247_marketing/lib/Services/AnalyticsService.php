<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\EventType;
use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Repositories\CampaignRepository;
use CloudHost247\Marketing\Repositories\EventRepository;
use CloudHost247\Marketing\Repositories\QueueRepository;
use WHMCS\Database\Capsule;

/**
 * Reporting (requirement #26, #27, #28).
 *
 * One rule shapes this whole class: **every number is a count of recorded
 * events.** Nothing is estimated, extrapolated or back-filled, and no rate is
 * ever shown as if it were delivery confirmation — the relay accepting a message
 * is not the same as a human receiving it, and a pixel fetch is not the same as
 * a person reading the email. When a denominator is zero the rate is reported as
 * `null` and the screens render "—" rather than a comforting 0%.
 *
 * Reads only; analytics never writes to the ledger.
 */
final class AnalyticsService
{
    const OPEN_RATE_NOTE = 'Opens are tracking-pixel events and can include image prefetching by mail clients.';
    const DELIVERY_NOTE = 'A message counted as sent was accepted by the relay; delivery confirmation is only possible from bounce evidence.';

    private $campaigns;
    private $queue;
    private $events;

    public function __construct(CampaignRepository $campaigns = null, QueueRepository $queue = null, EventRepository $events = null)
    {
        $this->campaigns = $campaigns ?: new CampaignRepository();
        $this->queue = $queue ?: new QueueRepository();
        $this->events = $events ?: new EventRepository();
    }

    /**
     * Everything known about one campaign, from its own rows and its ledger.
     *
     * @return array
     */
    public function campaignSummary($campaignId)
    {
        $campaign = $this->campaigns->find((int) $campaignId);
        if (!$campaign) { return null; }

        $queue = $this->queue->countsForCampaign((int) $campaign->id);
        $events = $this->events->countByType((int) $campaign->id);
        $recipients = (int) $queue[QueueStatus::SENT] + (int) $queue[QueueStatus::FAILED] + (int) $queue[QueueStatus::SKIPPED] + (int) $queue[QueueStatus::QUEUED] + (int) $queue[QueueStatus::SENDING];

        $accepted = (int) $events[EventType::SENT];
        $opened = (int) $events[EventType::OPENED];
        $clicked = (int) $events[EventType::CLICKED];
        $bounced = (int) $events[EventType::BOUNCED];
        $unsubscribed = (int) $events[EventType::UNSUBSCRIBED];

        return array(
            'campaign' => $campaign,
            'status' => (string) $campaign->status,
            'audience_size' => $recipients,
            'counts' => array(
                'queued' => (int) $queue[QueueStatus::QUEUED],
                'sending' => (int) $queue[QueueStatus::SENDING],
                'accepted' => $accepted,
                'failed' => (int) $queue[QueueStatus::FAILED],
                'skipped' => (int) $queue[QueueStatus::SKIPPED],
                'opened' => $opened,
                'clicked' => $clicked,
                'unsubscribed' => $unsubscribed,
                'bounced' => $bounced,
                'complaints' => (int) $events[EventType::COMPLAINT],
            ),
            'rates' => array(
                'open' => $this->rate($opened, $accepted),
                'click' => $this->rate($clicked, $accepted),
                'click_to_open' => $this->rate($clicked, $opened),
                'bounce' => $this->rate($bounced, $recipients),
                'unsubscribe' => $this->rate($unsubscribed, $accepted),
            ),
            'notes' => array(self::DELIVERY_NOTE, self::OPEN_RATE_NOTE),
        );
    }

    /**
     * Deployment-wide totals for a rolling window, plus the busiest campaigns.
     *
     * @param int $days window in days (1–365)
     */
    public function overview($days = 30)
    {
        $days = max(1, min(365, (int) $days));
        $cutoff = date('Y-m-d H:i:s', time() - ($days * 86400));

        $totals = array();
        foreach (EventType::all() as $type) { $totals[$type] = 0; }
        $perCampaign = array();
        foreach ($this->eventRows(null, $cutoff) as $row) {
            $type = (string) $row->type;
            if (!isset($totals[$type])) { continue; }
            $totals[$type]++;
            $campaignId = (int) $row->campaign_id;
            if ($campaignId <= 0) { continue; }
            if (!isset($perCampaign[$campaignId])) { $perCampaign[$campaignId] = array('name' => '', 'campaign_id' => $campaignId, 'accepted' => 0, 'opened' => 0, 'clicked' => 0, 'unsubscribed' => 0); }
            if ($type === EventType::SENT) { $perCampaign[$campaignId]['accepted']++; }
            if ($type === EventType::OPENED) { $perCampaign[$campaignId]['opened']++; }
            if ($type === EventType::CLICKED) { $perCampaign[$campaignId]['clicked']++; }
            if ($type === EventType::UNSUBSCRIBED) { $perCampaign[$campaignId]['unsubscribed']++; }
        }

        $campaigns = array();
        foreach ($perCampaign as $entry) {
            $row = $this->campaigns->find((int) $entry['campaign_id']);
            $entry['name'] = $row ? (string) $row->name : 'Deleted campaign #' . (int) $entry['campaign_id'];
            $entry['open_rate'] = $this->rate((int) $entry['opened'], (int) $entry['accepted']);
            $campaigns[] = $entry;
        }
        usort($campaigns, function ($a, $b) { return $b['accepted'] - $a['accepted']; });
        $campaigns = array_slice($campaigns, 0, 20);

        return array(
            'days' => $days,
            'window_start' => $cutoff,
            'totals' => $totals,
            'rates' => array(
                'open' => $this->rate((int) $totals[EventType::OPENED], (int) $totals[EventType::SENT]),
                'click' => $this->rate((int) $totals[EventType::CLICKED], (int) $totals[EventType::SENT]),
                'bounce' => $this->rate((int) $totals[EventType::BOUNCED], (int) $totals[EventType::SENT]),
                'unsubscribe' => $this->rate((int) $totals[EventType::UNSUBSCRIBED], (int) $totals[EventType::SENT]),
            ),
            'campaigns' => $campaigns,
            'campaign_statuses' => $this->campaignStatusCounts(),
            'notes' => array(self::DELIVERY_NOTE, self::OPEN_RATE_NOTE),
        );
    }

    /** Clicks per registered link for one campaign (the click map). */
    public function clickMap($campaignId)
    {
        $links = array();
        foreach ($this->linkRows((int) $campaignId) as $link) {
            $links[(int) $link->id] = array('link_id' => (int) $link->id, 'url' => (string) $link->url, 'clicks' => 0);
        }

        $unlinked = 0;
        foreach ($this->eventRows((int) $campaignId, null) as $row) {
            if ((string) $row->type !== EventType::CLICKED) { continue; }
            $meta = array();
            if (!empty($row->meta_json)) {
                $decoded = json_decode((string) $row->meta_json, true);
                if (is_array($decoded)) { $meta = $decoded; }
            }
            $linkId = isset($meta['link_id']) ? (int) $meta['link_id'] : 0;
            if ($linkId > 0 && isset($links[$linkId])) { $links[$linkId]['clicks']++; } else { $unlinked++; }
        }

        $rows = array_values($links);
        usort($rows, function ($a, $b) { return $b['clicks'] - $a['clicks']; });
        return array(
            'links' => $rows,
            'total_clicks' => array_sum(array_map(function ($row) { return (int) $row['clicks']; }, $rows)),
            'unattributed' => $unlinked,
        );
    }

    /**
     * Per-recipient activity: what happened to each message of a campaign.
     * Bounded and ordered by the queue, never by the ledger.
     */
    public function recipientActivity($campaignId, $limit = 100)
    {
        $rows = $this->queueRows((int) $campaignId, $limit);
        $activity = array();
        foreach ($rows as $row) { $activity[(int) $row->id] = array(); }

        foreach ($this->eventRows((int) $campaignId, null) as $event) {
            $queueId = (int) $event->queue_id;
            if (!isset($activity[$queueId])) { continue; }
            $activity[$queueId][] = (string) $event->type;
        }

        $out = array();
        foreach ($rows as $row) {
            $types = isset($activity[(int) $row->id]) ? $activity[(int) $row->id] : array();
            $out[] = array(
                'queue_id' => (int) $row->id,
                'email' => (string) $row->email,
                'status' => (string) $row->status,
                'attempts' => (int) $row->attempts,
                'accepted_at' => $row->sent_at === null ? '' : (string) $row->sent_at,
                'opens' => count(array_keys($types, EventType::OPENED, true)),
                'clicks' => count(array_keys($types, EventType::CLICKED, true)),
                'unsubscribed' => in_array(EventType::UNSUBSCRIBED, $types, true),
                'last_error' => (string) $row->last_error,
            );
        }
        return $out;
    }

    /** Daily counts for one campaign (or the whole deployment) over a window. */
    public function timeline($campaignId = 0, $days = 14)
    {
        $days = max(1, min(90, (int) $days));
        $cutoff = date('Y-m-d H:i:s', time() - ($days * 86400));
        $buckets = array();
        for ($offset = $days - 1; $offset >= 0; $offset--) {
            $day = date('Y-m-d', time() - ($offset * 86400));
            $buckets[$day] = array('day' => $day, 'sent' => 0, 'opened' => 0, 'clicked' => 0, 'failed' => 0, 'unsubscribed' => 0, 'bounced' => 0);
        }

        foreach ($this->eventRows($campaignId > 0 ? (int) $campaignId : null, $cutoff) as $row) {
            $day = substr((string) $row->occurred_at, 0, 10);
            if (!isset($buckets[$day])) { continue; }
            $type = (string) $row->type;
            if ($type === EventType::SENT) { $buckets[$day]['sent']++; }
            elseif ($type === EventType::OPENED) { $buckets[$day]['opened']++; }
            elseif ($type === EventType::CLICKED) { $buckets[$day]['clicked']++; }
            elseif ($type === EventType::FAILED) { $buckets[$day]['failed']++; }
            elseif ($type === EventType::UNSUBSCRIBED) { $buckets[$day]['unsubscribed']++; }
            elseif ($type === EventType::BOUNCED) { $buckets[$day]['bounced']++; }
        }
        return array_values($buckets);
    }

    /** How many campaigns sit in each state (used by the analytics header). */
    public function campaignStatusCounts()
    {
        $counts = array();
        foreach (CampaignStatus::all() as $status) { $counts[$status] = 0; }
        foreach (Capsule::table(CampaignRepository::TABLE)->get()->all() as $row) {
            $status = (string) $row->status;
            if (isset($counts[$status])) { $counts[$status]++; }
        }
        return $counts;
    }

    /**
     * A rate as a percentage with one decimal, or null when it cannot be
     * computed honestly (no denominator). Null renders as "—", never as 0%.
     */
    public function rate($numerator, $denominator)
    {
        $denominator = (int) $denominator;
        if ($denominator <= 0) { return null; }
        return round(((int) $numerator * 100) / $denominator, 1);
    }

    public function formatRate($rate)
    {
        return $rate === null ? '—' : number_format((float) $rate, 1) . '%';
    }

    // ------------------------------------------------------------------ reads

    private function eventRows($campaignId, $since)
    {
        $query = Capsule::table(EventRepository::TABLE);
        if ($campaignId !== null) { $query->where('campaign_id', (int) $campaignId); }
        if ($since !== null) { $query->where('occurred_at', '>=', (string) $since); }
        $rows = $query->limit(20000)->get();
        return $rows ? $rows->all() : array();
    }

    private function linkRows($campaignId)
    {
        $rows = Capsule::table('mod_cloudhost247_marketing_links')->where('campaign_id', (int) $campaignId)->limit(500)->get();
        return $rows ? $rows->all() : array();
    }

    private function queueRows($campaignId, $limit)
    {
        $rows = Capsule::table(QueueRepository::TABLE)->where('campaign_id', (int) $campaignId)->orderBy('id', 'asc')->limit(max(1, (int) $limit))->get();
        return $rows ? $rows->all() : array();
    }
}
