<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Campaign store (requirement #7, #13, #21).
 *
 * A campaign row carries the content that was approved — subject, sender
 * identity, rendered HTML and text — plus the audience reference, never a copy
 * of the audience itself. Status changes go through `setStatus()` so no caller
 * can leave a campaign in a state the domain does not define, and every row
 * keeps an idempotency key so a retried create cannot double-book a send.
 */
final class CampaignRepository
{
    const TABLE = 'mod_cloudhost247_marketing_campaigns';
    const MAX_PER_PAGE = 100;

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByIdempotencyKey($key)
    {
        return Capsule::table(self::TABLE)->where('idempotency_key', (string) $key)->first();
    }

    public function paginate(array $filters = array(), $page = 1, $perPage = 25)
    {
        $page = max(1, (int) $page);
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) $perPage));
        $query = Capsule::table(self::TABLE);

        if (!empty($filters['status'])) {
            $status = (string) $filters['status'];
            if (CampaignStatus::isValid($status)) { $query->where('status', $status); }
        }
        if (!empty($filters['search'])) {
            $term = '%' . str_replace('%', '', (string) $filters['search']) . '%';
            $query->where(function ($group) use ($term) {
                $group->where('name', 'like', $term)->orWhere('subject', 'like', $term);
            });
        }

        $totalRow = $query->selectRaw('COUNT(*) AS aggregate')->first();
        $total = $totalRow ? (int) $totalRow->aggregate : 0;
        $rows = $query->orderBy('id', 'desc')->limit($perPage)->offset(($page - 1) * $perPage)->get();

        return array(
            'rows' => $rows ? $rows->all() : array(),
            'total' => $total,
            'page' => $page,
            'pages' => (int) ceil($total / $perPage),
        );
    }

    public function count($status = null)
    {
        $query = Capsule::table(self::TABLE);
        if ($status !== null) { $query->where('status', (string) $status); }
        $row = $query->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    public function countsByStatus()
    {
        $counts = array();
        foreach (CampaignStatus::all() as $status) { $counts[$status] = 0; }
        foreach (Capsule::table(self::TABLE)->get()->all() as $row) {
            $status = (string) $row->status;
            if (isset($counts[$status])) { $counts[$status]++; }
        }
        return $counts;
    }

    /**
     * Creates a campaign. The caller supplies the idempotency key; creating the
     * same key twice returns the existing row instead of a second campaign.
     *
     * @param array $data name, subject, preview_text, from_name, from_email,
     *                    reply_to, template_id, design, html, text, audience_type,
     *                    audience_id, created_by, idempotency_key
     */
    public function create(array $data)
    {
        $key = (string) $data['idempotency_key'];
        $existing = $this->findByIdempotencyKey($key);
        if ($existing) { return $existing; }

        $now = date('Y-m-d H:i:s');
        $id = Capsule::table(self::TABLE)->insertGetId(array(
            'name' => $data['name'],
            'subject' => $data['subject'],
            'preview_text' => $data['preview_text'],
            'from_name' => $data['from_name'],
            'from_email' => $data['from_email'],
            'reply_to' => $data['reply_to'],
            'template_id' => $data['template_id'],
            'design_json' => $data['design'] === null ? null : json_encode($data['design']),
            'html' => (string) $data['html'],
            'text' => (string) $data['text'],
            'audience_type' => $data['audience_type'],
            'audience_id' => $data['audience_id'],
            'status' => CampaignStatus::DRAFT,
            'scheduled_at' => null,
            'scheduled_timezone' => 'UTC',
            'started_at' => null,
            'completed_at' => null,
            'failed_at' => null,
            'failure_reason' => '',
            'created_by' => (int) $data['created_by'],
            'idempotency_key' => $key,
            'created_at' => $now,
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    /**
     * Updates the editable content of a campaign. Status is never written here:
     * transitions belong to `setStatus()`, so a content edit cannot skip a state.
     */
    public function update($id, array $data)
    {
        $campaign = $this->find($id);
        if (!$campaign) { throw new \InvalidArgumentException('Unknown campaign.'); }

        $updates = array('updated_at' => date('Y-m-d H:i:s'));
        foreach (array('name', 'subject', 'preview_text', 'from_name', 'from_email', 'reply_to') as $field) {
            if (array_key_exists($field, $data)) { $updates[$field] = (string) $data[$field]; }
        }
        if (array_key_exists('template_id', $data)) { $updates['template_id'] = $data['template_id'] === null ? null : (int) $data['template_id']; }
        if (array_key_exists('design', $data)) { $updates['design_json'] = $data['design'] === null ? null : json_encode($data['design']); }
        if (array_key_exists('html', $data)) { $updates['html'] = (string) $data['html']; }
        if (array_key_exists('text', $data)) { $updates['text'] = (string) $data['text']; }
        if (array_key_exists('audience_type', $data)) { $updates['audience_type'] = (string) $data['audience_type']; }
        if (array_key_exists('audience_id', $data)) { $updates['audience_id'] = $data['audience_id'] === null ? null : (int) $data['audience_id']; }

        Capsule::table(self::TABLE)->where('id', (int) $campaign->id)->update($updates);
        return $this->find((int) $campaign->id);
    }

    /**
     * Writes a status plus only the timestamps that status owns. A cancellation
     * does not clear `started_at`: the history of what happened stays readable.
     */
    public function setStatus($id, $status, array $extra = array())
    {
        if (!CampaignStatus::isValid($status)) {
            throw new \InvalidArgumentException('Unknown campaign status: ' . (string) $status);
        }
        $campaign = $this->find($id);
        if (!$campaign) { throw new \InvalidArgumentException('Unknown campaign.'); }

        $updates = array('status' => $status, 'updated_at' => date('Y-m-d H:i:s'));
        if (array_key_exists('scheduled_at', $extra)) { $updates['scheduled_at'] = $extra['scheduled_at']; }
        if (array_key_exists('scheduled_timezone', $extra)) { $updates['scheduled_timezone'] = (string) $extra['scheduled_timezone']; }
        if (array_key_exists('started_at', $extra)) { $updates['started_at'] = $extra['started_at']; }
        if (array_key_exists('completed_at', $extra)) { $updates['completed_at'] = $extra['completed_at']; }
        if (array_key_exists('failed_at', $extra)) { $updates['failed_at'] = $extra['failed_at']; }
        if (array_key_exists('failure_reason', $extra)) { $updates['failure_reason'] = InputValidator::shortText($extra['failure_reason'], 255, 'Failure reason'); }

        Capsule::table(self::TABLE)->where('id', (int) $campaign->id)->update($updates);
        return $this->find((int) $campaign->id);
    }

    /** Campaigns a dispatcher should pick up, oldest schedule first. */
    public function due($now, $limit = 25)
    {
        $rows = Capsule::table(self::TABLE)
            ->where('status', CampaignStatus::SCHEDULED)
            ->where('scheduled_at', '<=', (string) $now)
            ->orderBy('scheduled_at', 'asc')
            ->limit(max(1, (int) $limit))
            ->get();
        return $rows ? $rows->all() : array();
    }
}
