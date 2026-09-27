<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceShutdownRequest extends Call
{
    public $action = "services/:id/shutdown";
    public $type = parent::TYPE_POST;
}
