<?php

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting;
use WHMCS\View\Menu\Item as MenuItem;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

$hookManager->register(
    function (MenuItem $primarySidebar)
    {
        $request = sl('request');
        $repo = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository();
        if(!$request->get('id'))
        {
            return;
        }
        $pid = Hosting::find($request->get('id'))->packageid;
        if(!\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers\ResellerModuleChecker::isProperProduct($pid))
        {
            return;
        }

        $productType = $repo->getProductSettings($pid)['resellerProductType'];
        $actions = $primarySidebar->getChild('Service Details Actions');
        if(!$actions)
        {
            return;
        }


        foreach ($actions->getChildren() as $action)
        {
            $action->setLabel(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl('lang')->T($productType, $action->getLabel()));
        }
    },
    100
);



