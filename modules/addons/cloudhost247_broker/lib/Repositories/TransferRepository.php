<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

final class TransferRepository
{
    const TABLE = 'mod_cloudhost247_broker_transfers';

    public function findByIdempotencyKey($key)
    {
        return Capsule::table(self::TABLE)->where('idempotency_key', (string) $key)->first();
    }

    public function currentForCase($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id', 'desc')->first();
    }

    public function forCase($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id', 'desc')->get();
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
}
