<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\CustomFields;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\CustomFieldsValues;

class CustomFieldValueSynchronizer
{
    public function synchronize(array $customFieldValues, int $pid): void
    {
        foreach ($customFieldValues as $serviceId => $customFieldValue)
        {
            try
            {
                $customField = CustomFields::leftJoin('tblcustomfieldsvalues', 'tblcustomfieldsvalues.fieldid', '=', 'tblcustomfields.id')
                    ->where('fieldname', 'serviceId|Service ID')
                    ->where('tblcustomfieldsvalues.value', $serviceId)
                    ->first();
                if (!$customField)
                {
                    continue;
                }
                $sid = $customField->relid;

                foreach ($customFieldValue as $name => $value)
                {
                    $relid = CustomFields::where('fieldname', $name)
                        ->where('relid', $pid)
                        ->first()
                        ->id;
                    $model = CustomFieldsValues::where('fieldid', $relid)->where('relid', $sid)->first();
                    if ($model->value)
                    {
                        continue;
                    }
                    if (!$model)
                    {
                        CustomFieldsValues::create([
                            'fieldid' => $relid,
                            'relid'   => $sid,
                            'value'   => $value
                        ]);
                    }
                    else
                    {
                        $model->value = $value;
                        $model->save();
                    }
                }
            }
            catch (\Exception $e)
            {
                logModuleCall(
                    'Smtphosting',
                    __FUNCTION__,
                    ['serviceid' => $sid],
                    $e->getMessage(),
                    $e->getTraceAsString()
                );
            }
        }
    }

    public function synchronizeService(array $customFieldValues, int $sid, int $pid): void
    {
        foreach ($customFieldValues as $serviceId => $customFieldValue)
        {
            try
            {
                $customField = CustomFields::leftJoin('tblcustomfieldsvalues', 'tblcustomfieldsvalues.fieldid', '=', 'tblcustomfields.id')
                    ->where('fieldname', 'serviceId|Service ID')
                    ->where('tblcustomfieldsvalues.value', $serviceId)
                    ->first();
                if (!$customField || $customField->relid != $sid)
                {
                    continue;
                }
                foreach ($customFieldValue as $name => $value)
                {
                    $fieldid = CustomFields::where('fieldname', $name)
                        ->where('relid', $pid)
                        ->first()
                        ->id;
                    if (!$fieldid)
                    {
                        continue;
                    }
                    $model = CustomFieldsValues::where('fieldid', $fieldid)->where('relid', $sid)->first();

                    if ($model->value)
                    {
                        continue;
                    }
                    if (!$model)
                    {
                        CustomFieldsValues::create([
                            'fieldid' => $fieldid,
                            'relid'   => $sid,
                            'value'   => $value
                        ]);
                    }
                    else
                    {
                        $model->value = $value;
                        $model->save();
                    }
                }
            }
            catch (\Exception $e)
            {
                logModuleCall(
                    'Smtphosting',
                    __FUNCTION__,
                    ['serviceid' => $sid],
                    $e->getMessage(),
                    $e->getTraceAsString()
                );
            }
        }
    }
}
