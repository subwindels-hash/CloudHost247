<?php
use WHMCS\View\Menu\Item as MenuItem;
use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers\ResellerModuleChecker;

$hookManager->register(
    function (MenuItem $primarySidebar) {
        $request = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl('request');

        $isProperModule = ResellerModuleChecker::isProperModule(__DIR__);
        if(!$isProperModule)
        {
            return;
        }

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
                        $panel->setUri("clientarea.php?action=productdetails&id={$_REQUEST['id']}");
                        $panel->setAttributes([]);
                    }
                }
            }
        }

    }, 943
);

