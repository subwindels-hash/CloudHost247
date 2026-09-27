<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Calls;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Call;

class StepTwo extends Call
{
    public $action = "services/:id/sslStepTwo";

    public $type = parent::TYPE_POST;
}