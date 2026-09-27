<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceTerminateRequest extends Call
{
    public $action = "services/:id/terminate";

    public $type = parent::TYPE_POST;

}