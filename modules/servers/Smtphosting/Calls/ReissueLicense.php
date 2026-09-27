<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

/**
 * Description of CheckAvailability
 *
 * @author inbs
 */
class ReissueLicense extends Call
{
    public $action = "services/:id/reissue";

    public $type = parent::TYPE_POST;

}