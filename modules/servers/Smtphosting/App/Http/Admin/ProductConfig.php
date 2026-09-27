<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Admin;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Pages\ConfigForm;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Sections\CustomFieldsWidget;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\AbstractController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config\PackageConfiguration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\UI\ConfigurableOption\OptionsWidget;

class ProductConfig extends AbstractController
{
    public function index()
    {
        try
        {
            $view                 = Helper\viewIntegrationAddon()
                ->addElement(ConfigForm::class);
            $packageConfiguration = new PackageConfiguration();

            if (!empty($packageConfiguration->getConfigurationForResellerProduct()['configurableOptions']))
            {
                $view->addElement(OptionsWidget::class);
            }

            if (!empty($packageConfiguration->getConfigurationForResellerProduct()['customFields']))
            {
                $view->addElement(CustomFieldsWidget::class);
            }
        }
        catch (\Exception $e)
        {
            logModuleCall('Smtphosting', 'Config Options', $e->getMessage(), $e->getTraceAsString());
            throw $e;
        }
        return $view;
    }
}