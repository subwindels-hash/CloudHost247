<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Sections;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Hidden;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Select;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Text;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\BoxSection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\HalfPageSection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\SectionLuRow;

class First extends BoxSection implements AdminArea
{
    protected $id = 'first';
    protected $name = 'first';
    protected $title = 'firstTitle';

    public function initContent()
    {
        $resellerProduct = new Select('resellerProduct');
        $resellerProduct->setDescription('resellerProductDescription');
        $resellerProduct->addGroupName('mgpci');
        $this->addField($resellerProduct);

        $billingCycle = new Select('billingCycle');
        $billingCycle->setDescription('billingCycleDescription');
        $billingCycle->addGroupName('mgpci');

        $row = new SectionLuRow('igRow');
        $row->setMainContainer($this->mainContainer);
        $hps = new HalfPageSection('hps');
        $hps->setMainContainer($this->mainContainer);
        $hps->addField($billingCycle);
        $this->addSection($hps);

    }
}
