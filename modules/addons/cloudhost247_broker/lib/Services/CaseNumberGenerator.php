<?php
namespace CloudHost247\Broker\Services;

use WHMCS\Database\Capsule;

/**
 * Generates human-facing brokerage case numbers, e.g. BRK-2026-000184.
 *
 * Uniqueness is guaranteed by the database unique index on
 * mod_cloudhost247_broker_cases.case_number, not by this generator alone —
 * on the rare collision (concurrent requests in the same year) the caller
 * retries with the next candidate.
 */
final class CaseNumberGenerator
{
    public function next($year = null)
    {
        $year = $year ?: date('Y');
        $prefix = 'BRK-' . $year . '-';
        $last = Capsule::table('mod_cloudhost247_broker_cases')
            ->where('case_number', 'like', $prefix . '%')
            ->orderBy('id', 'desc')
            ->value('case_number');
        $next = 1;
        if ($last && preg_match('/^BRK-\d{4}-(\d{6})$/', $last, $m)) {
            $next = (int) $m[1] + 1;
        }
        return $prefix . str_pad((string) $next, 6, '0', STR_PAD_LEFT);
    }
}
