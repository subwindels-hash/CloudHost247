<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting;

class Synchronizer
{
    const CUSTOM_FIELDS   = 'customFields';
    const SERVICE_DETAILS = 'serviceDetails';

    const SERVICE_DETAILS_TO_SYNCHRONIZE = [
        'domain'
    ];

    /**
     * @param int $sid
     * @param int $pid
     * @param array $serviceData with 'customFields' key if needed
     * @return void
     */
    public static function synchronizeService(int $sid, int $pid, array $serviceData): void
    {
        if (array_key_exists(self::SERVICE_DETAILS, $serviceData) && !empty($serviceData[self::SERVICE_DETAILS]))
        {
            self::synchronizeServiceDetails($sid, $pid, $serviceData[self::SERVICE_DETAILS]);
        }
        if (array_key_exists(self::CUSTOM_FIELDS, $serviceData) && !empty($serviceData[self::CUSTOM_FIELDS]))
        {
            self::synchronizeCustomFields($sid, $pid, $serviceData[self::CUSTOM_FIELDS]);
        }
    }

    protected static function synchronizeServiceDetails(int $sid, int $pid, array $serviceDetails): void
    {
        $hosting = Hosting::find($sid);
        foreach ($serviceDetails as $key => $serviceDetail)
        {
            if (in_array($key, self::SERVICE_DETAILS_TO_SYNCHRONIZE))
            {
                $hosting->{$key} = $serviceDetail;
            }
        }
        $hosting->save();
    }

    protected static function synchronizeCustomFields(int $sid, int $pid, array $customFieldsData): void
    {
        $synchro = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\CustomFieldValueSynchronizer();
        $synchro->synchronizeService($customFieldsData, $sid, $pid);
    }
}