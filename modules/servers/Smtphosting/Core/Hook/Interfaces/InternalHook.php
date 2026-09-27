<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook\Interfaces;

interface InternalHook
{
    public function __construct($params);

    public function execute();
}
