<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Hook;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Http\Integration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Smarty;

/**
 *  class HookIntegratorView
 *  Prepares a views basing on /App/Integrations/Admin/ & /App/Integrations/Client controlers
 *  to be injected on WHMCS subpages
 */
class HookIntegratorView
{
    use RequestObjectHandler;
    use Lang;
    use Smarty;

    /**
     * @var null|string|\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\View
     * integration data
     */
    protected $view = null;

    /**
     * @var null|string
     * HTML integration code
     */
    protected $HTMLData = null;

    public function __construct($view, $integration)
    {
        $this->view = $view;
    }

    /**
     * returns string/HTML integration code
     */
    public function getHTML()
    {
        $this->viewToHtml();

        return $this->HTMLData;
    }

    /**
     * transforms integration data to string to be integrated in WHMCS template
     */
    protected function viewToHtml()
    {
        if ($this->view instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\View)
        {
            $resp                      = $this->view->getResponse();
            $integrationPageController = DependencyInjection::call(Integration::class);
            $integrationPageController->setControllerResult($resp);

            $this->HTMLData = $integrationPageController->execute();

            return true;
        }

        if (is_string($this->view))
        {
            $this->HTMLData = $this->view;

            return true;
        }

        $this->HTMLData = '';
    }
}
