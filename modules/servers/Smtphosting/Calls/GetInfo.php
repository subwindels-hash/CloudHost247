<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

class GetInfo extends Call
{
    public $action = "services/:id/getInfo";

    public $type = parent::TYPE_GET;
}