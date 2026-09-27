<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Http;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\ClientArea;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\HttpController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook\InternalHooksWrapper;

class ClientPageController extends HttpController implements ClientArea
{
    public function execute($params = null)
    {
        //run hook before client area page is loaded
        $hookWrapper = new InternalHooksWrapper();
        $newParams   = $hookWrapper->runInternalHook('PreClientAreaPageLoad', $params);
        if ($newParams && is_array($newParams))
        {
            $params = $newParams;
        }

        return parent::execute($params);
    }
}
