<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Helpers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;

class AdminAreaServicePage
{
    use RequestObjectHandler;

    public function getServiceId()
    {
        if ((int)$this->getRequestValue('id', 0) > 0)
        {
            return (int)$this->getRequestValue('id', 0);
        }

        if ((int)$this->getRequestValue('productselect', 0) > 0)
        {
            return (int)$this->getRequestValue('productselect', 0);
        }

        return $this->getServiceIdByUserId();
    }

    public function getServiceIdByUserId()
    {
        $hosting = Hosting::where([
            'userid' => $this->getRequestValue('userid', 0)
        ])->orderBy('domain', 'ASC')->first();

        return $hosting->id;
    }
}
