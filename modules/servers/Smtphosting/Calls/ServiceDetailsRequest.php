<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceDetailsRequest extends Call
{
    public $action = "services/:id";

    public $type = parent::TYPE_GET;

    protected function setVariablesInActionString(): void
    {
        $this->action = str_replace([":id"], [$this->params["id"]], $this->action);
    }

}
