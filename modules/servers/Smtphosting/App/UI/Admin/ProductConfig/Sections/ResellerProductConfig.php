<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Sections;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Providers\Config;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Switcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\BoxSection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\HalfPageSection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\SectionLuRow;

class ResellerProductConfig extends BoxSection implements AdminArea
{
    use Lang;

    protected $id = 'resellerProductConfig';
    protected $name = 'resellerProductConfig';
    protected $title = 'resellerProductConfigTitle';

    public function initContent()
    {
        $this->loadLang();
        $this->lang->setContext('serverAA', 'productConfig', 'mainContainer', 'configForm', 'resellerProductConfig');
        $row = new SectionLuRow('igRow');
        $row->setMainContainer($this->mainContainer);

        $hps = new HalfPageSection('hps');
        $hps->setMainContainer($this->mainContainer);

        $provider = new Config();
        $provider->reload();

        $actions = $provider->getActionsForResellerProduct();
        foreach ($actions as $id => $actionName)
        {
            $action = new Switcher('action_' . $actionName);
            $action->addGroupName('mgpci');
            $action->setRawTitle($this->lang->absoluteTranslate('serverAA','productConfig','mainContainer','configForm','resellerProductConfig',"mgpci[" . lcfirst($actionName) . "]",'startDescription', $actionName));
            if ($id % 2 === 0)
            {
                $this->addField($action);
            }
            else
            {
                $hps->addField($action);
            }
        }
        $row->addSection($hps);
        $this->addSection($hps);
        $this->loadDataToForm($provider);
    }
}
