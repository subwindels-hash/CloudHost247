<?php

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use WHMCS\View\Menu\Item as MenuItem;

$hookManager->register(
    function (MenuItem $primarySidebar)
    {
        $isProperModule = \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers\ResellerModuleChecker::isProperModule(__DIR__);
        if(!$isProperModule)
        {
            return;
        }

        $actions = $primarySidebar->getChild('Service Details Actions');
        if(!$actions)
        {
            return;
        }
        $actions->removeChild('Change Password');
    },
    100
);
