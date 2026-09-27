<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceChangePasswordRequest extends Call
{
    public $action = "services/:id/changepassword";

    public $type = parent::TYPE_POST;

}