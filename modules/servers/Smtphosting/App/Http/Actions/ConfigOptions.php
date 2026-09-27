<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Pages\ConfigForm;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\TestConnectionRequest;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use WHMCS\Product\Product;

class ConfigOptions extends AddonController
{
    const PRODUCT_LIST_CACHE_KEY = "configOptionsProductList";

    public function execute($params = null)
    {
        try
        {
            $productId = $this->getRequestValue('id');
            $product   = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Product::findOrFail($productId);

            if (!$this->productsInfoList)
            {
                $call = new  TestConnectionRequest(Configuration::create($product->toArray()), []);
                $call->process();
            }
            if (($this->getRequestValue('action') === 'module-settings' || ($this->getRequestValue('loadData') && $this->getRequestValue('ajax') == '1')))
            {
                return [\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Admin\ProductConfig::class, 'index'];
            }
            else
            {
                if ($this->getRequestValue('action') === 'save')
                {
                    $form = new ConfigForm();
                    $form->runInitContentProcess();
                    $form->returnAjaxData();
                }
            }
        }
        catch (\Exception $e)
        {
            throw $e;
        }
    }
}
