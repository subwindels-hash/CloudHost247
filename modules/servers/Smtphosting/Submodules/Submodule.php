<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules;


interface Submodule
{
    //todo get rid of getInfo
    public function getInfo(array $params);

    public function getAAInfo(array $params);

    public function details(array $params);
}
