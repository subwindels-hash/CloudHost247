<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Traits;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Helpers\AdminAreaServicePage;

trait AdminAreaServicePageHelper
{
    protected $adminAreaServicePageHelper = null;

    public function loadAreaServicePageHelper()
    {
        if ($this->adminAreaServicePageHelper === null)
        {
            $this->adminAreaServicePageHelper = new AdminAreaServicePage();
        }
    }

    public function getServiceIdForAAServicePage()
    {
        $this->loadAreaServicePageHelper();

        return $this->adminAreaServicePageHelper->getServiceId();
    }
}
