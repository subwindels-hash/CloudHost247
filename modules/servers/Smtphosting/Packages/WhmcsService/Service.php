<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes\ErrorCodesLib;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\CustomFieldValue;
use WHMCS\Database\Capsule;

class Service
{
    protected $serviceId = null;

    protected $service = null;

    public function __construct($serviceId = null)
    {
        $this->setServiceId($serviceId);

        $this->loadWhmcsService();
    }

    /**
     * @return null
     */
    public function getServiceId()
    {
        return $this->serviceId;
    }

    public function getProductId()
    {
        return $this->service->packageid;
    }

    public function getServiceInstanceId()
    {
        $customFields = $this->getCustomFieldsValues();

        return $customFields['InstanceId']['value'];
    }

    public function getServiceName()
    {
        return $this->service->domain;
    }

    public function getCustomFieldsValues()
    {
        $model  = new CustomFieldValue();
        $fields = $model->select('tblcustomfields.fieldname as name', 'value')
            ->join('tblcustomfields', 'tblcustomfields.id', '=', 'fieldid')
            ->where('type', 'product')
            ->where('tblcustomfields.relid', $this->getProductId())
            ->where('tblcustomfieldsvalues.relid', $this->serviceId)->get();

        $fields = $fields ? $fields->toArray() : [];

        $parsedFields = [];
        foreach ($fields as $field)
        {
            $nameParts = explode('|', $field['name']);

            $parsedFields[$nameParts[0]] = [
                'rawName'     => $nameParts[0],
                'name'        => $field['name'],
                'value'       => $field['value'],
                'displayName' => $nameParts[1] ? $nameParts[1] : $nameParts[0]
            ];
        }

        return $parsedFields;
    }

    protected function setServiceId($serviceId = null)
    {
        $relationId = (int)$serviceId;
        if ($relationId <= 0)
        {
            throw new Exception(ErrorCodesLib::CORE_WS_000001);
        }

        $this->serviceId = $relationId;
    }

    protected function loadWhmcsService()
    {
        $this->service = \WHMCS\Service\Service::find($this->serviceId);
    }

    public function getConfigurableOptionsValues()
    {
        $options = Capsule::table('tblhostingconfigoptions')->select(['*', 'tblproductconfigoptionssub.optionname as subname'])
            ->join('tblproductconfigoptionssub', 'tblproductconfigoptionssub.id', '=', 'tblhostingconfigoptions.optionid')
            ->join('tblproductconfigoptions', 'tblproductconfigoptions.id', '=', 'tblhostingconfigoptions.configid')
            ->where('tblhostingconfigoptions.relid', $this->serviceId)->get();

        if (!($options))
        {
            return [];
        }

        $optionsData = [];
        foreach ($options as $option)
        {
            $rawOptionName               = $this->configOptionNameToRaw($option->optionname) ?: $option->optionname;
            $optionsData[$rawOptionName] = [
                'optionNameRaw'    => $rawOptionName,
                'optionName'       => $option->optionname,
                'subOptionName'    => $option->subname,
                'subOptionNameRaw' => $this->configOptionNameToRaw($option->subname) ?: $option->subname,
                'value'            => $option->optiontype == 4 ? $option->qty : $this->configOptionNameToRaw($option->subname) ?: $option->subname
            ];
        }

        return $optionsData;
    }

    public function configOptionNameToRaw($optionName)
    {
        if (!is_string($optionName) || trim($optionName) === '' || substr($optionName, 0, 1) === '|')
        {
            return false;
        }

        if (strpos($optionName, '|') > 0)
        {
            $parts = explode('|', $optionName);

            return $parts[0];
        }

        return $optionName;
    }
}
