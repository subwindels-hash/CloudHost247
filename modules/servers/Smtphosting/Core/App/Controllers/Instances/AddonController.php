<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Http\PageNotFound;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Interfaces\DefaultController;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\JsonResponse;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\ResponseResolver;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ViewAjax;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ViewIntegrationAddon;

abstract class AddonController implements DefaultController
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\OutputBuffer;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\IsAdmin;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\ErrorCodesLibrary;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\AppParams;

    public function runExecuteProcess($params = null)
    {
        $this->loadLangContext();

        $resault = $this->execute($params);

        if ($resault instanceof JsonResponse)
        {
            $resolver = new ResponseResolver($resault);

            $resolver->resolve();
        }

        if ($this->isValidIntegrationCallback($resault))
        {
            $this->setAppParam('IntegrationControlerName', $resault[0]);
            $this->setAppParam('IntegrationControlerMethod', $resault[1]);

            //to do catch exceptions
            $resault = Helper\di($resault[0], $resault[1]);
        }

        if ($resault instanceof ViewAjax)
        {
            $this->resolveAjax($resault);
        }

        if (!$resault instanceof ViewIntegrationAddon)
        {
            return $resault;
        }

        if ($resault instanceof JsonResponse)
        {
            $resolver = new ResponseResolver($resault);

            $resolver->resolve();
        }

        $addonIntegration = $this->getIntegrationControler($params['action']);

        return $addonIntegration->runExecuteProcess($resault);

    }

    public function isValidIntegrationCallback($callback = null)
    {
        if(empty($callback))
        {
            return false;
        }
        $callback = array_reverse($callback);
        $class = array_pop($callback);
        $method = array_pop($callback);

        return $class && $method && method_exists($class, $method);
    }

    public function resolveAjax($resault)
    {
        $ajaxResponse = $resault->getResponse();

        $resolver = new ResponseResolver($ajaxResponse);

        $resolver->resolve();
    }

    protected function getIntegrationControler($action = null)
    {
        switch ($action)
        {
            case 'ConfigOptions':
                return Helper\di(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Http\ConfigOptionsIntegration::class);
                break;
            case 'AdminServicesTabFields':
                return Helper\di(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Http\AdminServicesTabFieldsIntegration::class);
                break;
            default:
                return Helper\di(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Http\AddonIntegration::class);
        }
    }

    public function loadLangContext()
    {
        $this->loadLang();

        if ($this->getAppParam('IntegrationControlerName'))
        {
            $parts = explode('\\', $this->getAppParam('IntegrationControlerName'));

            $controller = end($parts);
        }
        else
        {
            $parts = explode('\\', get_class($this));

            $controller = end($parts);
        }

        $this->lang->setContext(($this->getAppParam('moduleAppType') . ($this->isAdmin() ? 'AA' : 'CA')), lcfirst($controller));
    }
}
