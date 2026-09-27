<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceReinstallRequest extends Call
{
    public $action = "services/:id/reinstall";

    public $type = parent::TYPE_POST;
}