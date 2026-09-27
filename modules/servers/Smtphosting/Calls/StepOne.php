<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

class StepOne extends Call
{
    public $action = "services/:id/sslStepOne";

    public $type = parent::TYPE_POST;
}