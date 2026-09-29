<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/**
 * Communication thread. `visibility` keeps private broker notes strictly
 * separate from customer-visible messages (requirement #6): every query the
 * customer-facing controller runs filters visibility = 'customer'.
 */
final class MessageRepository
{
    const TABLE = 'mod_cloudhost247_broker_messages';

    public function create(array $data)
    {
        $data['created_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::TABLE)->insertGetId($data);
    }

    /** Customer-visible thread only. Never returns an internal note. */
    public function customerThread($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->where('visibility', 'customer')->orderBy('id')->get();
    }

    /** Full thread (customer + internal) for the admin/broker view. */
    public function fullThread($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id')->get();
    }
}
