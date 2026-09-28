<?php
namespace CloudHost247\Smm\Repositories;

use CloudHost247\Smm\Contracts\ProviderFinder;
use WHMCS\Database\Capsule;

/** Capsule-backed provider/mapping/service access. */
final class ProviderRepository implements ProviderFinder
{
    const PROVIDERS = 'mod_cloudhost247_smm_providers';
    const SERVICES = 'mod_cloudhost247_smm_services';
    const MAPPINGS = 'mod_cloudhost247_smm_mappings';

    public function all()
    {
        return Capsule::table(self::PROVIDERS)->orderBy('priority')->orderBy('name')->get();
    }

    public function find($id)
    {
        return Capsule::table(self::PROVIDERS)->where('id', (int) $id)->first();
    }

    public function findProvider($providerId)
    {
        return $this->find($providerId);
    }

    public function enabled()
    {
        return Capsule::table(self::PROVIDERS)->where('enabled', 1)->orderBy('priority')->get();
    }

    public function create(array $data)
    {
        $now = date('Y-m-d H:i:s');
        $data['created_at'] = $now;
        $data['updated_at'] = $now;
        return Capsule::table(self::PROVIDERS)->insertGetId($data);
    }

    public function update($id, array $data)
    {
        $data['updated_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::PROVIDERS)->where('id', (int) $id)->update($data);
    }

    public function markProviderError($providerId, $message)
    {
        $this->update($providerId, array(
            'connection_status' => 'error',
            'last_error' => mb_substr((string) $message, 0, 500),
            'last_error_at' => date('Y-m-d H:i:s'),
        ));
    }

    public function markProviderSuccess($providerId, $balance = null, $currency = null)
    {
        $fields = array(
            'connection_status' => 'ok',
            'last_error' => '',
            'last_error_at' => null,
            'last_success_at' => date('Y-m-d H:i:s'),
        );
        if ($balance !== null) {
            $fields['balance'] = mb_substr((string) $balance, 0, 32);
            $fields['balance_updated_at'] = date('Y-m-d H:i:s');
            if ($currency !== null && $currency !== '') {
                $fields['currency'] = mb_substr((string) $currency, 0, 8);
            }
        }
        $this->update($providerId, $fields);
    }

    public function countOrders($providerId)
    {
        return Capsule::table('mod_cloudhost247_smm_orders')->where('provider_id', (int) $providerId)->count();
    }

    public function remove($id)
    {
        return Capsule::table(self::PROVIDERS)->where('id', (int) $id)->delete() > 0;
    }

    // ------------------------------------------------------------- mappings

    public function activeMappingByProduct($productId)
    {
        return Capsule::table(self::MAPPINGS)
            ->where('product_id', (int) $productId)
            ->where('enabled', 1)
            ->first();
    }

    public function mappingById($id)
    {
        return Capsule::table(self::MAPPINGS)->where('id', (int) $id)->first();
    }

    public function findService($serviceId)
    {
        return Capsule::table(self::SERVICES)->where('id', (int) $serviceId)->first();
    }

    public function mappingsWithJoins($filters = array(), $limit = 50, $offset = 0)
    {
        $q = Capsule::table(self::MAPPINGS . ' AS m')
            ->leftJoin(self::PROVIDERS . ' AS p', 'p.id', '=', 'm.provider_id')
            ->select('m.*', 'p.name AS provider_name', 'p.enabled AS provider_enabled');
        if (!empty($filters['provider_id'])) {
            $q->where('m.provider_id', (int) $filters['provider_id']);
        }
        if (isset($filters['enabled']) && $filters['enabled'] !== '') {
            $q->where('m.enabled', (int) $filters['enabled']);
        }
        if (!empty($filters['q'])) {
            $needle = '%' . str_replace(array('%', '_'), array('\\%', '\\_'), (string) $filters['q']) . '%';
            $q->where(function ($sub) use ($needle) {
                $sub->where('m.name', 'like', $needle)->orWhere('m.provider_service_id', 'like', $needle);
            });
        }
        return $q->orderBy('m.name')->orderBy('m.id')->skip((int) $offset)->take(min(100, max(1, (int) $limit)))->get();
    }

    public function countMappings($filters = array())
    {
        $q = Capsule::table(self::MAPPINGS);
        if (!empty($filters['provider_id'])) {
            $q->where('provider_id', (int) $filters['provider_id']);
        }
        if (isset($filters['enabled']) && $filters['enabled'] !== '') {
            $q->where('enabled', (int) $filters['enabled']);
        }
        return $q->count();
    }

    public function productHasOtherMapping($productId, $exceptMappingId)
    {
        $q = Capsule::table(self::MAPPINGS)->where('product_id', (int) $productId);
        if ($exceptMappingId) {
            $q->where('id', '!=', (int) $exceptMappingId);
        }
        return $q->exists();
    }

    public function createMapping(array $data)
    {
        $now = date('Y-m-d H:i:s');
        $data['created_at'] = $now;
        $data['updated_at'] = $now;
        return Capsule::table(self::MAPPINGS)->insertGetId($data);
    }

    public function updateMapping($id, array $data)
    {
        $data['updated_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::MAPPINGS)->where('id', (int) $id)->update($data);
    }

    public function deleteMapping($id)
    {
        return Capsule::table(self::MAPPINGS)->where('id', (int) $id)->delete();
    }

    public function disableMappingsForProvider($providerId)
    {
        return Capsule::table(self::MAPPINGS)->where('provider_id', (int) $providerId)->update(array(
            'enabled' => 0,
            'updated_at' => date('Y-m-d H:i:s'),
        ));
    }

    // -------------------------------------------------------------- services

    public function servicesForProvider($providerId)
    {
        return Capsule::table(self::SERVICES)->where('provider_id', (int) $providerId)
            ->orderBy('category')->orderBy('name')->get();
    }

    public function servicesWithJoins($filters = array(), $limit = 50, $offset = 0)
    {
        $q = Capsule::table(self::SERVICES . ' AS s')
            ->leftJoin(self::PROVIDERS . ' AS p', 'p.id', '=', 's.provider_id')
            ->select('s.*', 'p.name AS provider_name');
        if (!empty($filters['provider_id'])) {
            $q->where('s.provider_id', (int) $filters['provider_id']);
        }
        if (isset($filters['available']) && $filters['available'] !== '') {
            $q->where('s.available', (int) $filters['available']);
        }
        if (!empty($filters['category'])) {
            $q->where('s.category', mb_substr((string) $filters['category'], 0, 120));
        }
        if (!empty($filters['q'])) {
            $needle = '%' . str_replace(array('%', '_'), array('\\%', '\\_'), (string) $filters['q']) . '%';
            $q->where(function ($sub) use ($needle) {
                $sub->where('s.name', 'like', $needle)
                    ->orWhere('s.provider_service_id', 'like', $needle)
                    ->orWhere('s.category', 'like', $needle);
            });
        }
        return $q->orderBy('s.provider_id')->orderBy('s.category')->orderBy('s.name')
            ->skip((int) $offset)->take(min(100, max(1, (int) $limit)))->get();
    }

    public function countServices($filters = array())
    {
        $q = Capsule::table(self::SERVICES);
        if (!empty($filters['provider_id'])) {
            $q->where('provider_id', (int) $filters['provider_id']);
        }
        if (isset($filters['available']) && $filters['available'] !== '') {
            $q->where('available', (int) $filters['available']);
        }
        if (!empty($filters['category'])) {
            $q->where('category', mb_substr((string) $filters['category'], 0, 120));
        }
        return $q->count();
    }

    public function categoriesForProvider($providerId)
    {
        return Capsule::table(self::SERVICES)->where('provider_id', (int) $providerId)
            ->where('category', '!=', '')->distinct()->orderBy('category')->pluck('category');
    }

    public function updateService($id, array $data)
    {
        $data['updated_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::SERVICES)->where('id', (int) $id)->update($data);
    }

    public function deleteService($id)
    {
        $used = Capsule::table(self::MAPPINGS)->where('service_id', (int) $id)->exists();
        if ($used) {
            return false; // deleting a mapped service would orphan the mapping; refuse
        }
        return Capsule::table(self::SERVICES)->where('id', (int) $id)->delete() > 0;
    }

    public function deleteServicesForProvider($providerId)
    {
        return Capsule::table(self::SERVICES)->where('provider_id', (int) $providerId)->delete();
    }

    public function insertService(array $data)
    {
        $now = date('Y-m-d H:i:s');
        $data['created_at'] = $now;
        $data['updated_at'] = $now;
        return Capsule::table(self::SERVICES)->insertGetId($data);
    }
}
