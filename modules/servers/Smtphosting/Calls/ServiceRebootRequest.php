<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceRebootRequest extends Call
{
    public $action = "services/:id/reboot";

    public $type = parent::TYPE_POST;

}