<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Libs\AwsIntegration\ClientWrapper;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\AjaxFields\Select;

class Zone extends Select implements AdminArea
{
    protected $id = 'zone';
    protected $name = 'zone';
    protected $title = 'zone';

    /**
     * @var ClientWrapper $awsClient ;
     */
    protected $awsClient = null;

    protected $defaultVueComponentName = 'mg-ajax-select-with-data';

    public function prepareAjaxData()
    {
        $this->loadAwsClient();

        $this->setAvailableValues($this->loadAvailableZones());

        $this->setSelectedValue($this->getSelectedZone());
    }

    protected function loadAwsClient()
    {
        if (is_null($this->awsClient))
        {
            $productId = (int)$this->getRequestValue('id', 0);

            $this->awsClient = new ClientWrapper($productId, null, $this->getRequestValue('region', null));
        }
    }

    protected function loadAvailableZones()
    {
        $productId = (int)$this->getRequestValue('id', 0);

        $regions = $this->awsClient->getRegions();

        $processed[] = [
            'key'   => 'auto',
            'value' => 'Auto'
        ];

        foreach ($regions as $region)
        {
            if (!empty($region['availabilityZones']))
            {
                foreach ($region['availabilityZones'] as $zone)
                {
                    if ($zone['state'] !== "available")
                    {
                        continue;
                    }

                    $processed[] = [
                        'key'   => $zone['zoneName'],
                        'value' => $zone['zoneName']
                    ];
                }
            }
        }

        return $processed;
    }

    protected function getSelectedZone()
    {
        $productId = $this->getRequestValue('id');

        $settingRepo     = new Repository();
        $productSettings = $settingRepo->getProductSettings($productId);

        return ($productSettings['zone']) ?: reset($this->getAvailableValues())['key'];
    }
}
