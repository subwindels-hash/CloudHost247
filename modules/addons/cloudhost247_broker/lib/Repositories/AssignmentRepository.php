<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/** Append-only broker assignment history (requirement #7). */
final class AssignmentRepository
{
    const TABLE = 'mod_cloudhost247_broker_assignments';

    public function record($caseId, $adminId, $assignedByAdminId, $action, $note = '')
    {
        return Capsule::table(self::TABLE)->insert(array(
            'case_id' => (int) $caseId,
            'admin_id' => (int) $adminId,
            'assigned_by_admin_id' => (int) $assignedByAdminId,
            'action' => in_array($action, array('assigned', 'unassigned'), true) ? $action : 'assigned',
            'note' => substr((string) $note, 0, 500),
            'created_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function historyFor($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id')->get();
    }
}
