<?php
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
        if (is_a($actions, '\WHMCS\View\Menu\Item'))
        {
            $actions->removeChild('Custom Module Button Details');
            $actions->removeChild('Change Password');
        }

        if ($_REQUEST['action'] == "productdetails")
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
    },
    100
);
