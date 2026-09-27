<?php

use WHMCS\View\Menu\Item as MenuItem;

$hookManager->register(
    function (MenuItem $primarySidebar) {
        $request = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl('request');

        $isProperModule = \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers\ResellerModuleChecker::isProperModule(__DIR__);
        if (!$isProperModule)
        {
            return;
        }

        if ($request->get('action') == "productdetails")
        {
            $actions = $primarySidebar->getChild('Service Details Actions');
            if (is_a($actions, '\WHMCS\View\Menu\Item'))
            {
                $actions->removeChild('Change Password');
                $actions->removeChild('Custom Module Button sslStepOne');
                $actions->removeChild('Custom Module Button sslStepTwo');
                $actions->removeChild('Custom Module Button sslStepThree');
                $actions->removeChild('Upgrade/Downgrade Options');
            }
        }

    }, 943
);

