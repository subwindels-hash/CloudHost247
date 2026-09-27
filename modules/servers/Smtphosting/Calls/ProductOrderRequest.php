<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ProductOrderRequest extends Call
{
    public $action = "order/products/:id";

    protected function setVariablesInActionString(): void
    {
        $this->action = str_replace([":id"], [$this->params["id"]], $this->action);
    }

    public $type = parent::TYPE_POST;

}