<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/**
 * Case timeline (requirement #26). Insert-only; every entry originates from a
 * real service action, never a hard-coded display list.
 */
final class EventRepository
{
    const TABLE = 'mod_cloudhost247_broker_events';

    public function record(array $data)
    {
        $data['created_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::TABLE)->insertGetId($data);
    }

    public function customerTimeline($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->where('visibility', 'customer')->orderBy('id')->get();
    }

    public function fullTimeline($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id')->get();
    }
}
