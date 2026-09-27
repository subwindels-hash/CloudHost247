<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Sections;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\CustomFields\Buttons\AddCustomFields;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Providers\Config;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\AlertTypesConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others\CustomFieldsWidget as CustomFieldsWidgetBase;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\UI\ConfigurableOption\Buttons\AddOptions;

class CustomFieldsWidget extends CustomFieldsWidgetBase implements AdminArea
{
    protected $id = 'resellerCustomFields';
    protected $name = 'resellerCustomFields';
    protected $title = 'resellerCustomFieldsTitle';

    public function initContent()
    {
        $provider = new Config();
        $provider->reload();

        $this->customTplVars['customFields'] = $provider->getCustomFieldsForResellerProduct();

        $this->addButton(AddCustomFields::class);
        $this->addInternalAlert('customFieldsInfo', AlertTypesConstants::INFO, AlertTypesConstants::SMALL);
    }
}
