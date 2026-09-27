<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook;

use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\isAdmin;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\di;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\AppParams;

/**
 *  class HookIntegrator
 *  Prepares a views basing on /App/Integrations/Admin/ & /App/Integrations/Client controlers
 *  to be injected on WHMCS subpages
 */
class HookIntegrator
{
    use RequestObjectHandler;
    use AppParams;

    /**
     * @var null
     * an array of WHMCS hook params, in which the Integrator was used
     */
    protected $hookParams = null;

    /**
     * @var bool
     *  determines if  works on admin or client area side
     */
    protected $isAdmin = false;

    /** @var array
     *  avalible hook integrations list
     */
    protected $integrations = [];

    /** @var null|string
     * HTML data to be returned as a result of the integration process
     */
    protected $integrationData = [];

    public function __construct($hookParams)
    {
        $this->setHookParams($hookParams);

        $this->checkIsAdmin();

        $this->integrate();
    }

    public function setHookParams($hookParams)
    {
        if (is_array($hookParams))
        {
            $this->hookParams = $hookParams;
        }

        return $this;
    }

    /**
     * determines if  works on admin or client area side
     */
    public function checkIsAdmin()
    {
        $this->isAdmin = isAdmin();
    }

    /**
     * returns integration output
     */
    public function getHtmlCode()
    {
        return $this->getWrapperHtml();
    }

    /**
     * starts whole integration process
     */
    protected function integrate()
    {
        $this->loadAvailableIntegrations();

        $this->loadIntegrationData();
    }

    /**
     * loads available integration instances for current page
     */
    protected function loadAvailableIntegrations()
    {
        $hooksPath = ModuleConstants::getModuleRootDir() . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Integrations'
                     . DIRECTORY_SEPARATOR . ($this->isAdmin ? 'Admin' : 'Client');

        if (!file_exists($hooksPath) || !is_readable($hooksPath))
        {
            return false;
        }

        $files = scandir($hooksPath, 1);
        if ($files)
        {
            foreach ($files as $key => $value)
            {
                if ($value === "." || $value === ".." || !(stripos($value, '.php') > 0))
                {
                    unset($files[$key]);
                    continue;
                }

                $this->addIntegration(str_replace('.php', '', $value));
            }
        }
    }

    /**
     * adds integration instance to the integrations list for current page
     * @param null|string $className
     * @return bool
     */
    protected function addIntegration($className = null)
    {
        //check if integration class exists
        $integrationClassName = '\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Integrations\\' . ($this->isAdmin ? 'Admin' : 'Client') . '\\' . $className;
        if (!class_exists($integrationClassName) || !is_subclass_of($integrationClassName, \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook\AbstractHookIntegrationController::class))
        {
            return false;
        }

        //creates an instance of integration class
        $integrationInstance = DependencyInjection::create($integrationClassName);

        //check if integration should be added to current page
        if (!$this->validateIntegrationInstance($integrationInstance))
        {
            return false;
        }

        $this->integrations[] = $integrationInstance;
    }

    /**
     * check if the integration should be added to current page
     * @param null|AbstractHookIntegrationController $instance
     * @return bool
     */
    public function validateIntegrationInstance($instance = null)
    {
        if (!is_subclass_of($instance, \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook\AbstractHookIntegrationController::class))
        {
            return false;
        }

        if (
            $instance->getJqSelector() === null ||
            !is_callable($instance->getControllerCallback())
        )
        {
            return false;
        }

        return true;
    }

    public function loadIntegrationData()
    {
        foreach ($this->integrations as $integration)
        {
            if (!$this->isIntegrationApplicable($integration))
            {
                continue;
            }

            $callbackData = $integration->getControllerCallback();

            $this->setAppParam('IntegrationControlerName', $callbackData[0]);
            $this->setAppParam('IntegrationControlerMethod', $callbackData[1]);

            /** @var
             * $integrationResult \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\View
             */
            $integrationResult = call_user_func([di($callbackData[0]), $callbackData[1]]);
            if (!($integrationResult instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\View))
            {
                $this->setAppParam('IntegrationControlerName', null);
                $this->setAppParam('IntegrationControlerMethod', null);

                continue;
            }

            $integrationResult->setIsIntegration(true);

            $view = new HookIntegratorView($integrationResult, $integration);

            $this->updateIntegrationData($integration, $view->getHTML());

            $this->setAppParam('IntegrationControlerName', null);
            $this->setAppParam('IntegrationControlerMethod', null);
        }
    }

    /**
     * check if integration params match page/request params
     * @param null|AbstractHookIntegrationController $integration
     * @return bool
     */
    public function isIntegrationApplicable($integration = null)
    {
        //check just in case, in order not to kill whole WHMCS
        if (!$integration)
        {
            return false;
        }

        //check if filename is correct for the integration
        if ($this->hookParams['filename'] !== $integration->getFileName())
        {
            return false;
        }

        //check if all provided request params are correct for the integration
        foreach ($integration->getRequestParams() as $rKey => $rParam)
        {
            if (is_array($rParam))
            {
                $found = false;
                foreach ($rParam as $irParam)
                {
                    if ($this->getRequestValue($rKey) === $irParam)
                    {
                        $found = true;
                        break;
                    }
                }
                if (!$found)
                {
                    return false;
                }

            }
            elseif ($this->getRequestValue($rKey) !== $rParam)
            {
                return false;
            }
        }

        //check if integration callback is correct
        $integrationCallback = $integration->getControllerCallback();
        if ((!is_subclass_of($integrationCallback[0], \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\AbstractController::class)
             && !is_subclass_of($integrationCallback[0], \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\AbstractClientController::class))
            || !method_exists($integrationCallback[0], $integrationCallback[1]))
        {
            return false;
        }

        return true;
    }

    protected function updateIntegrationData($integrationDetails, $htmlData)
    {
        if (!is_string($htmlData) || $htmlData === '' || !$integrationDetails || !is_object($integrationDetails))
        {
            return false;
        }

        $this->integrationData[] = [
            'htmlData'           => $htmlData,
            'integrationDetails' => $integrationDetails
        ];
    }

    protected function getWrapperHtml()
    {
        if (!$this->integrationData)
        {
            return null;
        }

        $wrapper = new HookIntegrationsWrapper($this->integrationData);

        return $wrapper->getHtml();
    }
}
