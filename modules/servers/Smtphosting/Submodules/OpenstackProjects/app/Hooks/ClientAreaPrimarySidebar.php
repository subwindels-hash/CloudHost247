<?php

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use WHMCS\View\Menu\Item as MenuItem;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;


$hookManager->register(
    function (MenuItem $primarySidebar) {
        $isProperModule = \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers\ResellerModuleChecker::isProperModule(__DIR__);
        if (!$isProperModule)
        {
            return;
        }
        
        $actions = $primarySidebar->getChild('Service Details Actions');
        if (is_a($actions, '\WHMCS\View\Menu\Item'))
        {
            $actions->removeChild('Custom Module Button Details');
            $actions->removeChild('Change Password');
        }

        $hosting = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting::where('id', $_REQUEST['id'])->first();
        if (!$hosting)
        {
            return;
        }
        $resellerProductType = (new Repository())->getProductSettings($hosting->packageid)['resellerProductType'];

        if (strpos($resellerProductType, 'OpenstackProjects') === false)
        {
            return;
        }
        $lang = sl('lang');

        $primarySidebar->addChild('Management Panel', [
            "name"  => "managementPanel",
            "label" => $lang->T('managementPanel'),
            "icon"  => "fas fa-reply",
            "order" => "13",
        ]);

        $primarySidebar->getChild('Management Panel')->addChild(
            "panelLogin",
            [
                "name"  => "panelLogin",
                "label" => $lang->T('panelLogin'),
                "order" => "225",
                "uri"   => '#',
            ]);

    },
    100
);