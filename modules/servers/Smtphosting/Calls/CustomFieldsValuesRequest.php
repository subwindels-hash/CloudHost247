<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class CustomFieldsValuesRequest extends Call
{
    public $action = "customFieldsValues/:id";

    public $type = parent::TYPE_GET;

    protected function setVariablesInActionString(): void
    {
        $this->action = str_replace([":id"], [$this->params["pid"]], $this->action);
    }
}
