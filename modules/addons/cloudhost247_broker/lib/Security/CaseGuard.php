<?php
namespace CloudHost247\Broker\Security;

use CloudHost247\Broker\Repositories\CaseRepository;
use RuntimeException;

/**
 * Ownership and authorization boundary (requirement #30). Every customer
 * action must pass assertOwnedByClient(); every broker action must pass
 * assertAdminAuthorized(). Neither can be bypassed by guessing an ID.
 */
final class CaseGuard
{
    private $cases;

    public function __construct(CaseRepository $cases = null)
    {
        $this->cases = $cases ?: new CaseRepository();
    }

    /** @return object the case row, once ownership is confirmed */
    public function assertOwnedByClient($caseId, $clientId)
    {
        $clientId = (int) $clientId;
        if ($clientId <= 0) { throw new RuntimeException('Authentication is required.'); }
        $case = $this->cases->find($caseId);
        if (!$case || (int) $case->client_id !== $clientId) {
            throw new RuntimeException('Brokerage case not found.');
        }
        return $case;
    }

    /**
     * A broker/admin may act on a case only if it is unassigned or assigned to
     * them, unless they hold the platform-wide capability that lets a Super
     * Admin see every case.
     */
    public function assertAdminAuthorized($caseId, $adminId, $isSuperAdmin = false)
    {
        $case = $this->cases->find($caseId);
        if (!$case) { throw new RuntimeException('Brokerage case not found.'); }
        if ($isSuperAdmin) { return $case; }
        if ((int) $case->assigned_admin_id !== (int) $adminId) {
            throw new RuntimeException('You are not authorized to access this brokerage case.');
        }
        return $case;
    }
}
