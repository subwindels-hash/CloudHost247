<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\CpanelExtended;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\Cpanel\Cpanel;


class CpanelExtended extends Cpanel
{
    public function __call(string $name, array $arguments)
    {
        return sprintf('Method %s does not exist', $name);
    }
}
