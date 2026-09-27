<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Actions\CreateSSL;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\SSLSubmoduleChecker;
use WHMCS\Product\Product;

class CreateAccount implements AbstractAction
{
    protected $params;

    public function __construct(array $params)
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
        $cycle         = str_replace(["-"], [""], $this->params['model']->billingcycle);
        $cycle         = preg_replace("/\s/", "", $cycle);
        $cycle         = strtolower($cycle);
        //Order Product
        $configRepo = new Repository();
        $productSettings = $configRepo->getProductSettings($this->params['pid']);
        $postfields =
            [
                'id'             => $productSettings['resellerProductId'], //reseller product id
                'hostname'       => $this->params['domain'],
                'cycle'          => ($productSettings['billingCycle'] && $productSettings['billingCycle'] !== 'auto') ? $productSettings['billingCycle'] : $cycle,
                'username'       => $this->params['username'],
                'password'       => $this->params['password'],
                'nsprefix'       => [$this->params['model']->ns1, $this->params['model']->ns2],
                'configurations' => (array)$this->params['configoptions'],
                'fields'         => (array)$this->params['customfields']
            ];

        CreateSSL::checkIfExistsForId($this->params['serviceid']);
        $call     = new  Calls\ProductOrderRequest($configuration, $postfields);
        $response = $call->process();
        if ($response['error'])
        {
            return $response['error'];
        }
        $orderId   = $response['data']['orderId'];
        $serviceId = $response['data']['serviceId'];
        $service   = $response['data']['service'];
        if ($service['dedicatedip'])
        {
            $this->params['model']->dedicatedIp = $service['dedicatedip'];
            $this->params['model']->assignedIps = $service['assignedips'];
            $this->params['model']->save();
        }

        if($service['domain'])
        {
            $this->params['model']->domain = $service['domain'];
            $this->params['model']->save();
        }

        if($service['ns1'] || $service['ns2'])
        {
            $this->params['model']->ns1 = $service['ns1'];
            $this->params['model']->ns2 = $service['ns2'];
            $this->params['model']->save();
        }

        $this->createSsl();
        $this->saveCustomFields($serviceId, $orderId);
        return 'success';
    }

    /**
     *
     */
    protected function createSsl(): void
    {
        $isSSL = SSLSubmoduleChecker::check($this->params['serviceid']) || SSLSubmoduleChecker::checkByName($this->params['serviceid']);

        if ($isSSL)
        {
            $createSsl = new CreateSSL($this->params);
            $createSsl->run();
        }
    }

    /**
     * @param $serviceId
     * @param $orderId
     */
    protected function saveCustomFields($serviceId, $orderId): void
    {
        $customFiled = new HostingCustomField($this->params['pid'], $this->params['serviceid'], HostingCustomField::SERVICE_ID);
        $customFiled->update((string)$serviceId);
        $customFiled = new HostingCustomField($this->params['pid'], $this->params['serviceid'], HostingCustomField::ORDER_ID);
        $customFiled->update((string)$orderId);
    }

}