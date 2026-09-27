<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Libs\AwsIntegration\ClientWrapper;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\AjaxFields\Select;

class Region extends Select implements AdminArea
{
    protected $id = 'region';
    protected $name = 'region';
    protected $title = 'region';

    /**
     * @var ClientWrapper $awsClient ;
     */
    protected $awsClient = null;

    public function prepareAjaxData()
    {
        $this->loadAwsClient();

        $this->setAvailableValues($this->loadAvailableRegions());

        $this->setSelectedValue($this->getSelectedRegion());
    }

    protected function loadAwsClient()
    {
        if (is_null($this->awsClient))
        {
            $productId = (int)$this->getRequestValue('id', 0);

            $this->awsClient = new ClientWrapper($productId);
        }
    }

    protected function loadAvailableRegions()
    {
        $regions = $this->awsClient->getRegions();

        $processed = [];
        foreach ($regions as $region)
        {
            $processed[] = [
                'key'   => $region['name'],
                'value' => $region['displayName'] . ' ' . $region['name']
            ];
        }

        return $processed;
    }

    public function compareRegions($regions, $ami2)
    {
        return strnatcmp(strtolower($regions['value']), strtolower($ami2['value']));
    }

    protected function getSelectedRegion()
    {
        $productId = $this->getRequestValue('id');

        $settingRepo     = new Repository();
        $productSettings = $settingRepo->getProductSettings($productId);

        return ($productSettings['region']) ?: $this->awsClient->getRegion();
    }
}
