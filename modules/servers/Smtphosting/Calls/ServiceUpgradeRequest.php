<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceUpgradeRequest extends Call
{
    public $action = "services/:id/upgrade";

    public $type = parent::TYPE_POST;

}