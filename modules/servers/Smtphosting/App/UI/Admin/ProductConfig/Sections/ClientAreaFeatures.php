<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Sections;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields\Blueprint;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields\Bundles;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields\Platform;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields\Region;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\ProductConfig\Fields\Zone;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Number;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Switcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Text;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Textarea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\BoxSection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\HalfPageSection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Sections\SectionLuRow;


class ClientAreaFeatures extends BoxSection implements AdminArea
{
    protected $id = 'clientAreaFeatures';
    protected $name = 'clientAreaFeatures';
    protected $title = 'clientAreaFeaturesTitle';

    public function initContent()
    {
        $logApiRequests = new Switcher('clientAreaHistory');
        $logApiRequests->addGroupName('mgpci');
        $this->addField($logApiRequests);

        $logApiRequests = new Switcher('clientAreaMetric');
        $logApiRequests->addGroupName('mgpci');
        $this->addField($logApiRequests);

        $logApiRequests = new Switcher('clientAreaShowDisk');
        $logApiRequests->addGroupName('mgpci');
        $this->addField($logApiRequests);

        $enableSnapshots = new Switcher('clientAreasnapshots');
        $enableSnapshots->addGroupName('mgpci');
        $this->addField($enableSnapshots);

        $enableFirwall = new Switcher('clientAreafirewall');
        $enableFirwall->addGroupName('mgpci');
        $this->addField($enableFirwall);

        $enableServiceActionsStart = new Switcher('clientAreaServiceActionsStart');
        $enableServiceActionsStart->addGroupName('mgpci');

        $enableServiceActionsStop = new Switcher('clientAreaServiceActionsStop');
        $enableServiceActionsStop->addGroupName('mgpci');

        $enableServiceActionsReboot = new Switcher('clientAreaServiceActionsReboot');
        $enableServiceActionsReboot->addGroupName('mgpci');

        $enableServiceActionsConnectionDetails = new Switcher('clientAreaServiceActionsConnectionDetails');
        $enableServiceActionsConnectionDetails->addGroupName('mgpci');

        $row = new SectionLuRow('igRow');
        $row->setMainContainer($this->mainContainer);

        $hps = new HalfPageSection('hps');
        $hps->setMainContainer($this->mainContainer);
        $hps->addField($enableServiceActionsStart);
        $hps->addField($enableServiceActionsStop);
        $hps->addField($enableServiceActionsReboot);
        $hps->addField($enableServiceActionsConnectionDetails);

        $row->addSection($hps);
        $this->addSection($hps);
    }
}
