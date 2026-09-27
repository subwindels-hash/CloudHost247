<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Pages;


use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Providers\Config;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Sections\First;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Sections\ResellerProductConfig;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\FormIntegration;

class ConfigForm extends FormIntegration implements AdminArea
{
    protected $id = 'configForm';
    protected $name = 'configForm';
    protected $title = 'configFormTitle';

    public function initContent()
    {
        $provider = new Config();
        $this->setProvider($provider);

        $first = new First();
        $this->addSection($first);

        if ($this->isProductChosen($provider))
        {
            $resellerProductConfig = new ResellerProductConfig();
            $this->addSection($resellerProductConfig);
        }

        $this->loadDataToForm();
    }

    protected function isProductChosen(Config $provider)
    {
        $provider->reload();
        return !empty($provider->getProductSettings()['resellerProduct'])
               && !empty($provider->getActionsForResellerProduct());
    }

}
