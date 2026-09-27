<?php

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;
use WHMCS\View\Menu\Item as MenuItem;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

$hookManager->register(
    function (MenuItem $primarySidebar) {
        $request = sl('request');
        $isProperModule = \ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers\ResellerModuleChecker::isProperModule(__DIR__);

        if (!$isProperModule) {
            return;
        }

        if ($request->get('action') === "productdetails") {
            $actions = $primarySidebar->getChild('Service Details Actions');

            if (is_a($actions, '\WHMCS\View\Menu\Item')) {
                $panel = $actions->getChild('Custom Module Button ssoLogin');

                if ($panel) {
                    $panel->setLabel(sl('lang')->T('RTCustomServer Dashboard'));
                }

                if (!function_exists('ModuleBuildParams')) {
                    require_once ROOTDIR . "/includes/modulefunctions.php";
                }

                $params = \ModuleBuildParams($request->get('id'));

                if (!$params['customfields'][HostingCustomField::SERVICE_ID]) {
                    return;
                }

                // Example SSO or redirect call for your module
                $postfields = [
                    "id" => $params['customfields'][HostingCustomField::SERVICE_ID],
                ];
                $call = new Calls\ServiceSSORequest(Configuration::create($params), $postfields);
                $result = $call->process();

                if ($panel) {
                    $panel->setUri($result['data']['redirectTo']);
                    global $CONFIG;
                    if ($CONFIG['Template'] == 'lagom' || $CONFIG['Template'] == 'lagom2') {
                        $panel->setIcon('fas fa-sign-in-alt');
                    }
                    $ssoPermission = \checkContactPermission("productsso", true);
                    $ssoPermission ? $panel->setAttributes(['target' => '_blank']) : $panel->setAttributes(['disabled' => true]);
                }
            }
        }
    },
    943
);
