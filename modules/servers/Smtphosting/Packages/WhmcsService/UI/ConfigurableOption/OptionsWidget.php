<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\UI\ConfigurableOption;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\AlertTypesConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonBase;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons\ButtonModal;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others\ConfigurableOptionsWidget;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config\PackageConfiguration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Traits\ConfigurableOptionsConfig;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\UI\ConfigurableOption\Buttons\AddOptions;

class OptionsWidget extends ConfigurableOptionsWidget implements AdminArea
{
    use ConfigurableOptionsConfig;

    protected $id = 'optionsWidget';
    protected $name = 'optionsWidget';
    protected $title = 'optionsWidgetTitle';

    public function initContent()
    {
        $this->loadConfigurableOptionsList();
        $this->customTplVars['options'] = $this->configOptionsList;
        $this->addButton(AddOptions::class);
        $this->addInternalAlert('configurableOptionsInfo', AlertTypesConstants::INFO, AlertTypesConstants::SMALL);
    }

    protected function loadConfigurableOptionsList()
    {
        if (!$this->configOptionsList)
        {
            $packageConfiguration = new PackageConfiguration();

            $this->configOptionsList = $packageConfiguration->getConfigurationForResellerProduct()['configurableOptions'];
        }
    }

}
