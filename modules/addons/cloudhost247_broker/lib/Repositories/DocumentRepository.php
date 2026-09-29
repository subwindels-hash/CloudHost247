<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

final class DocumentRepository
{
    const TABLE = 'mod_cloudhost247_broker_documents';

    public function create(array $data)
    {
        $data['created_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::TABLE)->insertGetId($data);
    }

    public function customerVisible($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->where('visibility', 'customer')->orderBy('id', 'desc')->get();
    }

    public function all($caseId)
    {
        return Capsule::table(self::TABLE)->where('case_id', (int) $caseId)->orderBy('id', 'desc')->get();
    }

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }
}
