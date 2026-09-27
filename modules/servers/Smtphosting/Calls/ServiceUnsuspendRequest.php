<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceUnsuspendRequest extends Call
{
    public $action = "services/:id/unsuspend";

    public $type = parent::TYPE_POST;

}