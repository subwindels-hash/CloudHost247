<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

abstract class AppController
{
    public function runController($callerName, $params)
    {
        $controller = $this->getControllerInstanceClass($callerName, $params);

        $controllerInstance = ServiceLocator::call($controller);

        $result = $controllerInstance->runExecuteProcess($params);

        return $result;
    }
}
