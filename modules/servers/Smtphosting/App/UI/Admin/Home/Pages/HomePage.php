<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\UI\Admin\Home\Pages;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AdminArea;

class HomePage extends BaseContainer implements AdminArea
{
    public function getText()
    {
        return 'Pobrany tekst';
    }
}