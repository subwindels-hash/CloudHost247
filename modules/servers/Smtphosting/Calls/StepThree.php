<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

class StepThree extends Call
{
    public $action = "services/:id/sslStepThree";

    public $type = parent::TYPE_POST;
}