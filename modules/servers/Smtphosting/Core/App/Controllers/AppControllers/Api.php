<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\AppControllers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\AppController;

/**
 * The Smtphosting module exposes no public API endpoint, so no API controller is registered.
 *
 * Returning null tells the application dispatcher that this module exposes no controller for
 * the call, the same contract the Addon controller uses for unknown actions.
 */
class Api implements AppController
{
    public function getControllerInstanceClass($callerName, $params)
    {
        return null;
    }
}
