<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\AppControllers\Http;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\AppControllers\Addon;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\AppControllers\Api;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook\InternalHooksWrapper;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

use function \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\di;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\AppParams;

class Application
{
    use AppParams;

    public function run($callerName = null, $params = null)
    {
        try
        {
            $params = $this->runPreAppHook($params);

            $this->setWhmcsParams($params);

            $controller = $this->getControllerClass($callerName);


            $controllerInstance = ServiceLocator::call($controller);
            $result             = $controllerInstance->runController($callerName, $params);

            return $result;
        }
        catch (\Exception $exc)
        {
//            $errorPage = ServiceLocator::call(Controllers\Instances\Http\ErrorPage::class);
//
//            $params['mgErrorDetails'] = $exc;
//
//            $result = $errorPage->execute($params);
//
//            return $result;
            print_r($exc->getTraceAsString());
            return 'APP ERR: ' . $exc->getMessage();
        }
    }

    /**
     * Saves provided WHMCS params to WhmcsParams service
     * @param type array
     */
    protected function setWhmcsParams($params)
    {
        $whmcsParams = di('whmcsParams');
        $whmcsParams->setParams($params);
    }

    public function getControllerClass($callerName = null)
    {
        $functionName = str_replace($this->getModuleName() . '_', '', $callerName);
        switch ($functionName)
        {
            //HTTP controllers
            case 'output':
                return Http::class;
            case 'clientarea':
                return Http::class;

            //API controller
            case 'api':
                return Api::class;

            //Addon controllers
            default:
                return Addon::class;
        }
    }

    public function getModuleName()
    {
        return $this->getAppParam('systemName');
    }

    public function runPreAppHook($params = [])
    {
        //run hook before any app controllers runs
        $hookWrapper = new InternalHooksWrapper();
        $newParams   = $hookWrapper->runInternalHook('PreAppRun', $params);
        if ($newParams && $newParams !== false)
        {
            return $newParams;
        }

        return $params;
    }
}
