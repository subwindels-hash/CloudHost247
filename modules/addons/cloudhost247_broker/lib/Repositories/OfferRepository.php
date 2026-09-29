<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/**
 * Immutable offer/counteroffer ledger (requirement #20). Rows are never
 * updated or deleted — a new state (accept/reject/expire) is always a new
 * Events row referencing the offer id; this repository only ever inserts and
 * reads.
 */
final class OfferRepository
{
    const TABLE = 'mod_cloudhost247_broker_offers';

    public function findByIdempotencyKey($key)
    {
        if (!$key) { return null; }
        return Capsule::table(self::TABLE)->where('idempotency_key', (string) $key)->first();
    }

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function create(array $data)
    {
        $data['created_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::TABLE)->insertGetId($data);
    }

    public function forCase($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id')->get();
    }

    public function latestForCase($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id', 'desc')->first();
    }
}
