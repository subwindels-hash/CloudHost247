<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;

class ChangePackage implements AbstractAction
{
    protected $params;

    public function __construct($params)
    {
        $this->params = $params;
    }

    /**
     * @return string
     * @throws \Exception
     */
    public function process(): string
    {
        $configuration = Configuration::create($this->params);
        $configRepo = new Repository();
        $productSettings = $configRepo->getProductSettings($this->params['pid']);
        $postfields    =
            [
                'id'             => $this->params['customfields'][HostingCustomField::SERVICE_ID],
                'configurations' => (array)$this->params['configoptions'],
                'newProductId'   => $productSettings['resellerProductId'],
                'newCycle'       => ($productSettings['billingCycle'] && $productSettings['billingCycle'] !== 'auto') ? $productSettings['billingCycle'] : strtolower($this->params['model']->billingcycle),
            ];
        $call          = new  Calls\ServiceUpgradeRequest($configuration, $postfields);
        $result        = $call->process();
        return $result['error'] ?: 'success';
    }
}