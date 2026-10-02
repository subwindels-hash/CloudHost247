<?php
namespace CloudHost247\Marketing\Repositories;

use WHMCS\Database\Capsule;

/**
 * The frozen recipient list of one campaign (requirement #21, #22).
 *
 * Materialising recipients is what turns "this segment, evaluated live" into
 * "these exact addresses for this send". It happens once per campaign, right
 * before queueing, and the unique (campaign_id, email) pair means a re-run
 * cannot double up. The stored personalisation values are the whitelisted
 * subscriber fields only — never consent evidence, never a customer record.
 */
final class RecipientRepository
{
    const TABLE = 'mod_cloudhost247_marketing_campaign_recipients';

    const STATUS_PENDING = 'pending';
    const STATUS_SENT = 'sent';
    const STATUS_FAILED = 'failed';
    const STATUS_SKIPPED = 'skipped';

    public function findByCampaignAndEmail($campaignId, $email)
    {
        return Capsule::table(self::TABLE)
            ->where('campaign_id', (int) $campaignId)
            ->where('email', strtolower(trim((string) $email)))
            ->first();
    }

    /**
     * Adds one recipient unless it already exists for this campaign.
     *
     * @return int|null the new row id, or null when the address was present
     */
    public function add($campaignId, $subscriberId, $email, array $personal = array())
    {
        $email = strtolower(trim((string) $email));
        if ($email === '') { throw new \InvalidArgumentException('A recipient needs an address.'); }
        if ($this->findByCampaignAndEmail($campaignId, $email)) { return null; }

        $clean = array();
        foreach ($personal as $key => $value) {
            if (!is_scalar($value)) { continue; }
            $key = preg_replace('/[^a-z0-9_]/', '', strtolower((string) $key));
            if ($key === '') { continue; }
            $clean[substr($key, 0, 32)] = substr((string) $value, 0, 190);
        }

        return Capsule::table(self::TABLE)->insertGetId(array(
            'campaign_id' => (int) $campaignId,
            'subscriber_id' => $subscriberId === null ? null : (int) $subscriberId,
            'email' => $email,
            'personal_json' => $clean ? json_encode($clean) : null,
            'status' => self::STATUS_PENDING,
            'skip_reason' => '',
            'created_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function count($campaignId, $status = null)
    {
        $query = Capsule::table(self::TABLE)->where('campaign_id', (int) $campaignId);
        if ($status !== null) { $query->where('status', (string) $status); }
        $row = $query->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    /** Pending recipients, oldest first — the materialisation order. */
    public function pending($campaignId, $limit = 500)
    {
        $rows = Capsule::table(self::TABLE)
            ->where('campaign_id', (int) $campaignId)
            ->where('status', self::STATUS_PENDING)
            ->orderBy('id', 'asc')
            ->limit(max(1, (int) $limit))
            ->get();
        return $rows ? $rows->all() : array();
    }

    public function markSent($id)
    {
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array('status' => self::STATUS_SENT));
        return true;
    }

    public function markFailed($id, $reason = '')
    {
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array(
            'status' => self::STATUS_FAILED,
            'skip_reason' => substr((string) $reason, 0, 64),
        ));
        return true;
    }

    public function markSkipped($id, $reason = '')
    {
        Capsule::table(self::TABLE)->where('id', (int) $id)->update(array(
            'status' => self::STATUS_SKIPPED,
            'skip_reason' => substr((string) $reason, 0, 64),
        ));
        return true;
    }

    /** Whitelisted personalisation values for one subscriber address. */
    public function personalisation($subscriber)
    {
        if (!$subscriber) { return array(); }
        return array(
            'first_name' => isset($subscriber->first_name) ? (string) $subscriber->first_name : '',
            'last_name' => isset($subscriber->last_name) ? (string) $subscriber->last_name : '',
            'company' => isset($subscriber->company) ? (string) $subscriber->company : '',
            'country' => isset($subscriber->country) ? (string) $subscriber->country : '',
        );
    }
}
