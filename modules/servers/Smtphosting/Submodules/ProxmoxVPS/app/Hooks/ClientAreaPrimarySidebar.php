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

        $actions = $primarySidebar->getChild('Service Details Actions');
        if (is_a($actions, '\WHMCS\View\Menu\Item'))
        {
            $actions->removeChild('Custom Module Button Details');
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

            try
            {
                $panel = $actions->getChild('Custom Module Button noVncConsole');
                if ($panel)
                {
                    $panel->setAttributes(['target' => '_blank']);
                }
            }
            catch (\Exception $e)
            {
                $overview = $primarySidebar->getChild('Service Details Actions');
                $panel = $overview->getChild('Custom Module Button noVncConsole');
                if ($panel)
                {
                    $overview->removeChild('Custom Module Button noVncConsole');
                }
            }

            try
            {
                $panel = $actions->getChild('Custom Module Button xTermConsole');
                if ($panel)
                {
                    $panel->setAttributes(['target' => '_blank']);
                }
            }
            catch (\Exception $e)
            {
                $overview = $primarySidebar->getChild('Service Details Actions');
                $panel = $overview->getChild('Custom Module Button xTermConsole');
                if ($panel)
                {
                    $overview->removeChild('Custom Module Button xTermConsole');
                }
            }
        }
    }, 943
);

