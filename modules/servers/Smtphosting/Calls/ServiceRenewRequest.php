<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceRenewRequest extends Call
{
    public $action = "services/:id/renew";

    public $type = parent::TYPE_POST;

}