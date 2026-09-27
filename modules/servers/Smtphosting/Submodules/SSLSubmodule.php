<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules;


interface SSLSubmodule extends Submodule
{
    public function sslStepOne(array $params);

    public function sslStepTwo(array $params);

    public function sslStepThree(array $params);

//    public function includeHooks();
}