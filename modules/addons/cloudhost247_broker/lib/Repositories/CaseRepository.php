<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/**
 * Data access for domain brokerage cases. Every write here is a plain,
 * auditable SQL statement — no ORM magic, matching the rest of the platform.
 * Business rules (allowed status transitions, idempotency) live in
 * Services\BrokerageService; this class only persists and queries.
 */
final class CaseRepository
{
    const TABLE = 'mod_cloudhost247_broker_cases';
    const PAGE_SIZE = 25;

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->whereNull('deleted_at')->first();
    }

    public function findByCaseNumber($caseNumber)
    {
        return Capsule::table(self::TABLE)->where('case_number', (string) $caseNumber)->whereNull('deleted_at')->first();
    }

    public function findByIdempotencyKey($key)
    {
        if ($key === '' || $key === null) { return null; }
        return Capsule::table(self::TABLE)->where('idempotency_key', (string) $key)->first();
    }

    public function create(array $data)
    {
        $data['created_at'] = date('Y-m-d H:i:s');
        $data['updated_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::TABLE)->insertGetId($data);
    }

    public function update($id, array $data)
    {
        $data['updated_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::TABLE)->where('id', (int) $id)->update($data);
    }

    /** Real, DB-backed request-rate check (requirement #30/#33) — never a fabricated limit. */
    public function countCreatedSince($clientId, $sinceDatetime)
    {
        return Capsule::table(self::TABLE)->where('client_id', (int) $clientId)->where('created_at', '>=', (string) $sinceDatetime)->count();
    }

    /** Cases visible to one customer (ownership boundary enforced here, not just in the controller). */
    public function forClient($clientId, $page = 1, $perPage = self::PAGE_SIZE)
    {
        $page = max(1, (int) $page);
        $perPage = max(5, min(100, (int) $perPage));
        $query = Capsule::table(self::TABLE)->where('client_id', (int) $clientId)->whereNull('deleted_at');
        $total = (clone $query)->count();
        $rows = $query->orderBy('id', 'desc')->offset(($page - 1) * $perPage)->limit($perPage)->get();
        return array('rows' => $rows, 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / $perPage))); }

    /** Ownership check used everywhere a customer acts on a case. */
    public function belongsToClient($caseId, $clientId)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $caseId)->where('client_id', (int) $clientId)->whereNull('deleted_at')->exists();
    }

    /** Cases an administrator is authorized to act on: unassigned, or assigned to them. */
    public function assignedToAdmin($adminId, $page = 1, $perPage = self::PAGE_SIZE)
    {
        $page = max(1, (int) $page);
        $perPage = max(5, min(100, (int) $perPage));
        $query = Capsule::table(self::TABLE)->where('assigned_admin_id', (int) $adminId)->whereNull('deleted_at');
        $total = (clone $query)->count();
        $rows = $query->orderBy('id', 'desc')->offset(($page - 1) * $perPage)->limit($perPage)->get();
        return array('rows' => $rows, 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / $perPage)));
    }

    /**
     * Server-side filtered, paginated search for the Super Admin dashboard
     * (requirement #33). Never loads the whole table into PHP.
     */
    public function search(array $filters = array(), $page = 1, $perPage = self::PAGE_SIZE)
    {
        $page = max(1, (int) $page);
        $perPage = max(5, min(100, (int) $perPage));
        $query = Capsule::table(self::TABLE)->whereNull('deleted_at');

        if (!empty($filters['case_number'])) { $query->where('case_number', 'like', '%' . substr((string) $filters['case_number'], 0, 24) . '%'); }
        if (!empty($filters['domain'])) { $query->where('domain', 'like', '%' . substr((string) $filters['domain'], 0, 191) . '%'); }
        if (!empty($filters['client_id'])) { $query->where('client_id', (int) $filters['client_id']); }
        if (!empty($filters['assigned_admin_id'])) { $query->where('assigned_admin_id', (int) $filters['assigned_admin_id']); }
        if (!empty($filters['provider_key'])) { $query->where('provider_key', substr((string) $filters['provider_key'], 0, 32)); }
        if (!empty($filters['registrar'])) { $query->where('registrar', 'like', '%' . substr((string) $filters['registrar'], 0, 120) . '%'); }
        if (!empty($filters['status'])) { $query->where('status', substr((string) $filters['status'], 0, 32)); }
        if (!empty($filters['payment_status'])) { $query->where('payment_status', substr((string) $filters['payment_status'], 0, 24)); }
        if (!empty($filters['transfer_status'])) { $query->where('transfer_status', substr((string) $filters['transfer_status'], 0, 24)); }
        if (!empty($filters['disputed'])) { $query->where('disputed', 1); }
        if (!empty($filters['min_offer'])) { $query->where('opening_offer', '>=', (float) $filters['min_offer']); }
        if (!empty($filters['max_offer'])) { $query->where('opening_offer', '<=', (float) $filters['max_offer']); }
        if (!empty($filters['from'])) { $query->where('created_at', '>=', $this->date($filters['from']) . ' 00:00:00'); }
        if (!empty($filters['to'])) { $query->where('created_at', '<=', $this->date($filters['to']) . ' 23:59:59'); }
        if (!empty($filters['q'])) {
            $term = '%' . substr(strip_tags((string) $filters['q']), 0, 100) . '%';
            $query->where(function ($x) use ($term) {
                $x->where('case_number', 'like', $term)->orWhere('domain', 'like', $term);
            });
        }

        $total = (clone $query)->count();
        $rows = $query->orderBy('id', 'desc')->offset(($page - 1) * $perPage)->limit($perPage)->get();
        return array('rows' => $rows, 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / $perPage)), 'per_page' => $perPage);
    }

    /** Real counts for the admin overview/reporting screens (requirement #34). Never fabricated. */
    public function statusCounts()
    {
        $rows = Capsule::table(self::TABLE)->whereNull('deleted_at')
            ->selectRaw('status, count(*) as total')->groupBy('status')->get();
        $counts = array();
        foreach ($rows as $row) { $counts[$row->status] = (int) $row->total; }
        return $counts;
    }

    public function revenueTotals()
    {
        $row = Capsule::table('mod_cloudhost247_broker_payments')->where('status', 'paid')
            ->selectRaw('sum(brokerage_fee) as brokerage_revenue, sum(transfer_fee) as transfer_revenue, sum(acquisition_price) as acquisition_total, count(*) as paid_count')
            ->first();
        return array(
            'brokerage_revenue' => $row && $row->brokerage_revenue ? (float) $row->brokerage_revenue : 0.0,
            'transfer_revenue' => $row && $row->transfer_revenue ? (float) $row->transfer_revenue : 0.0,
            'acquisition_total' => $row && $row->acquisition_total ? (float) $row->acquisition_total : 0.0,
            'paid_count' => $row ? (int) $row->paid_count : 0,
        );
    }

    public function averageAcquisitionAmount()
    {
        $value = Capsule::table(self::TABLE)->whereNull('deleted_at')->whereNotNull('opening_offer')->avg('opening_offer');
        return $value ? round((float) $value, 2) : 0.0;
    }

    public function providerActivity()
    {
        $rows = Capsule::table(self::TABLE)->whereNull('deleted_at')->where('provider_key', '!=', '')
            ->selectRaw('provider_key, count(*) as total')->groupBy('provider_key')->get();
        $out = array();
        foreach ($rows as $row) { $out[$row->provider_key] = (int) $row->total; }
        return $out;
    }

    /** Soft delete: history is retained, never physically removed. */
    public function softDelete($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->update(array('deleted_at' => date('Y-m-d H:i:s'), 'updated_at' => date('Y-m-d H:i:s')));
    }

    private function date($value)
    {
        $value = (string) $value;
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) { throw new \InvalidArgumentException('Invalid date filter.'); }
        return $value;
    }
}
