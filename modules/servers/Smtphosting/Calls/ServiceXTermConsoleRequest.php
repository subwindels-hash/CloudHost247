<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceXTermConsoleRequest extends Call
{
    public $action = "services/:id/xTermConsole";
    public $type = parent::TYPE_POST;
}