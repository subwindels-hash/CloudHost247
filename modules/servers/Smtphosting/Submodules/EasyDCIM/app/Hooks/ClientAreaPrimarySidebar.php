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
        $request = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl('request');

        $actions = $primarySidebar->getChild('Service Details Actions');

        if ($request->get('action') == "productdetails")
        {
            $overview = $primarySidebar->getChild('Service Details Overview');
            if (!is_a($overview, '\WHMCS\View\Menu\Item'))
            {
                return;
            }
            $panel = $overview->getChild('Information');
            if (is_a($panel, '\WHMCS\View\Menu\Item'))
            {
                $panel = $primarySidebar->getChild('Service Details Overview');
                if (is_a($panel, 'WHMCS\View\Menu\Item'))
                {
                    $panel = $panel->getChild('Information');
                    if (is_a($panel, 'WHMCS\View\Menu\Item'))
                    {
                        $panel->setUri("clientarea.php?action=productdetails&id={$request->get('id')}");
                        $panel->setAttributes([]);
                    }
                }
            }
        }
    },
    100
);
