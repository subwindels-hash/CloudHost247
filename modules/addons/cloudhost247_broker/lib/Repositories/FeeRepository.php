<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/** Fee rules for Super Admin -> Domain Brokerage -> Fees (requirement #22). */
final class FeeRepository
{
    const TABLE = 'mod_cloudhost247_broker_fees';

    public function all()
    {
        return Capsule::table(self::TABLE)->orderBy('applies_to')->orderBy('id')->get();
    }

    public function enabled()
    {
        return Capsule::table(self::TABLE)->where('enabled', 1)->get();
    }

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
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

    public function delete($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->delete();
    }
}
