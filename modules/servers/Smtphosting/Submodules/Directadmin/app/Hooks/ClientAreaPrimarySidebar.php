<?php

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use WHMCS\View\Menu\Item as MenuItem;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

$hookManager->register(
    function (MenuItem $primarySidebar) {
        $request        = \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl('request');
        $isProperModule = \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers\ResellerModuleChecker::isProperModule(__DIR__);

        if (!$isProperModule)
        {
            return;
        }
        if ($request->get('action') === "productdetails")
        {
            $actions = $primarySidebar->getChild('Service Details Actions');
            if (is_a($actions, '\WHMCS\View\Menu\Item'))
            {
                $actions->removeChild('Custom Module Button Details');
            }

            if ($request->get('action') === "productdetails")
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

            try
            {
                $panel = $actions->getChild('Custom Module Button ssoLogin');

                if ($panel)
                {
                    $panel->setLabel(sl('lang')->T('directAdmin', 'ssoLogin'));
                }

                if (!function_exists('ModuleBuildParams'))
                {
                    require_once ROOTDIR . "/includes/modulefunctions.php";
                }

                if ($panel)
                {
                    $actual_link = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://" . $_SERVER['HTTP_HOST'];
                    $panel->setUri($actual_link . $panel->getUri());

                    global $CONFIG;
                    if ($CONFIG['Template'] == 'lagom' || $CONFIG['Template'] == 'lagom2')
                    {
                        $panel->setIcon('fas fa-sign-in-alt');
                    }
                    $ssoPermission = \checkContactPermission("productsso", true);
                    $ssoPermission ? $panel->setAttributes(['target' => '_blank']) : $panel->setAttributes(['disabled' => true]);
                }
            }
            catch (\Exception $e)
            {
                $overview = $primarySidebar->getChild('Service Details Actions');
                $panel    = $overview->getChild('Custom Module Button SsoLogin');
                if ($panel)
                {
                    $overview->removeChild('Custom Module Button SsoLogin');
                }
            }

        }
    }, 943
);
