<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\AppControllers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\AppController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\AppParams;

class Addon extends \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\AppController implements AppController
{
    use AppParams;

    public function getControllerInstanceClass($callerName, $params)
    {
        $functionName = str_replace($this->getModuleName() . '_', '', $callerName);
        $coreAddon    = '\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon\\' . ucfirst($functionName);

        if (class_exists($coreAddon) && is_subclass_of($coreAddon, AddonController::class))
        {
            return $coreAddon;
        }

        $appAddon = '\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions\\' . ucfirst($functionName);

        if (class_exists($appAddon) && is_subclass_of($appAddon, AddonController::class))
        {
            return $appAddon;
        }

        return null;
    }

    public function getModuleName()
    {
        return $this->getAppParam('systemName');
    }
}
