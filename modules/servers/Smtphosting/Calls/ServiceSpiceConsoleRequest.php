<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ServiceSpiceConsoleRequest extends Call
{
    public $action = "services/:id/spiceConsole";
    public $type = parent::TYPE_POST;
}