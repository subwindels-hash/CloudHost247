<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon\Config;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Description of IsDebugOn
 *
 * @author INBSX-37H
 */
trait IsDebugOn
{
    protected $isDebug = null;

    public function isDebugOn()
    {
        if ($this->isDebug === null)
        {
            $addon = ServiceLocator::call(Config::class);

            $this->isDebug = (bool)((int)$addon->getConfigValue('debug', "0"));
        }

        return $this->isDebug;
    }
}
