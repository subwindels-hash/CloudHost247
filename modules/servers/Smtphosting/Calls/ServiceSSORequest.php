<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceSSORequest extends Call
{
    public $action = "services/:id/ssologin";

    public $type = parent::TYPE_POST;

}
