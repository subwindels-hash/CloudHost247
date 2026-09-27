<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServicePowerOffRequest extends Call
{
    public $action = "services/:id/powerOff";
    public $type = parent::TYPE_POST;
}
