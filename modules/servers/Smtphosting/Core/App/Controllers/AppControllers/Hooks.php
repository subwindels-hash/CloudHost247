<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\AppControllers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\AppController;

/**
 * The Smtphosting module registers no hook controller; WHMCS hooks are wired through Core\\Hook\\InternalHooksWrapper.
 *
 * Returning null tells the application dispatcher that this module exposes no controller for
 * the call, the same contract the Addon controller uses for unknown actions.
 */
class Hooks implements AppController
{
    public function getControllerInstanceClass($callerName, $params)
    {
        return null;
    }
}
