<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\ServiceDetailsRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Cache\Services\DatabaseCache;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Facades\Cache;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Synchronizer;

/**
 * Class MetaData
 *
 */
class Synchronize extends AddonController
{
    public function execute($params = null)
    {
        try
        {
            $product     = \WHMCS\Product\Product::findOrFail($params['pid']);
            $sid         = $params['serviceid'];
            $resellerPid = (new Repository())->getProductSettings($params['pid'])['resellerProductId'];

            $serviceDetails = $this->getServiceDetails($params);
            $call    = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\CustomFieldsValuesRequest(
                \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration::create($product->toArray()), [
                'pid' => $resellerPid
            ]);
            $result  = $call->process();


            $serviceData = [
                'serviceDetails' => $serviceDetails,
                'customFields' => $result['data']
            ];

            Synchronizer::synchronizeService($sid, $params['pid'], $serviceData);
        }
        catch (\Exception $e)
        {
            return ['error' => 'An error ocurred during synchronization'];
        }

        return 'success';
    }

    protected function getServiceDetails(array $params): array
    {
        $serviceDetails = [];
        $postfields =
            [
                "id" => $params['customfields'][HostingCustomField::SERVICE_ID],
            ];
        Cache::init();
        $cacheKey = DatabaseCache::SERVICE_DETAILS_CACHE_KEY . $postfields['id'];

        $serviceDetails = Cache::get($cacheKey);

        if (!$serviceDetails)
        {
            $call           = new  ServiceDetailsRequest(Configuration::create($params), $postfields);
            $serviceDetails = $call->process();
            Cache::remember($cacheKey, $serviceDetails, 1);
        }

        return $serviceDetails;
    }
}
