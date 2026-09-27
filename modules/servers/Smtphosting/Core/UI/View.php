<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\Request;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\TemplateConstants;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\AppParams;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\IsDebugOn;

/**
 * Main View Controller
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class View
{
    use Traits\AppLayouts;
    use Traits\CustomJsCode;
    use Traits\ViewBreadcrumb;
    use AppParams;
    use IsDebugOn;

    /**
     * Controler for all widgets inside of View
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\MainContainer
     */
    protected $mainContainer = null;
    protected $template = null;
    protected $name;
    protected $isBreadcrumbs = true;
    protected $templateDir = null;
    protected $defaultComponentsJs = null;

    protected $integration = false;

    public function __construct($template = null)
    {
        $this->setTemplate($template);
        $this->mainContainer = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\MainContainer();
        $this->initBreadcrumbs();
        $this->initCustomAssetFiles();
    }

    /**
     * Adds elements to the root element
     */
    public function addElement($element, $containerName = null)
    {
        $this->mainContainer->addElement($element, $containerName);

        return $this;
    }

    /**
     * Generates all responses for UI elements
     */
    public function getResponse()
    {
        $this->mainContainer->setTemplate($this->getAppLayoutTemplateDir(), $this->getAppLayout());

        $request = Request::build();
        if ($request->get('ajax', false))
        {
            return $this->mainContainer->getAjaxResponse();
        }

        return Helper\response([
            'tpl'    => $this->template,
            'tplDir' => $this->templateDir,
            'data'   => [
                'mainContainer' => $this->mainContainer,
                'customJsCode'  => $this->getCustomJsCode(),
                'customCssCode' => $this->getCustomCssCode(),
                'breadcrumbs'   => $this->getBreadcrumbs()
            ]
        ])->setStatusCode(200)->setName($this->name)->setBreadcrumbs($this->isBreadcrumbs);
    }

    public function validateAcl($isAdmin)
    {
        $this->mainContainer->valicateACL($isAdmin);

        return $this;
    }

    /**
     * Sets custom View template
     */
    public function setTemplate($template = null)
    {
        if ($template === null)
        {
            $this->template    = 'view';
            $this->templateDir = ModuleConstants::getTemplateDir()
                                 . DS . (Helper\isAdmin() ? TemplateConstants::ADMIN_PATH : TemplateConstants::CLIENT_PATH)
                                 . DS . TemplateConstants::MAIN_DIR;

            return;
        }

        $this->template    = $template;
        $this->templateDir = null;
    }

    public function setName($name)
    {
        $this->name = $name;

        return $this;
    }

    public function disableBreadcrumbs()
    {
        $this->isBreadcrumbs = false;

        return $this;
    }

    /**
     * this function is deprecated
     * @return type
     */
    public function genResponse()
    {
        return $this->getResponse();
    }

    public function setIsIntegration($isIntegration = false)
    {
        if (is_bool($isIntegration))
        {
            $this->integration = $isIntegration;

            $this->initCustomAssetFiles();
        }
    }

    public function isIntegration()
    {
        return $this->integration;
    }
}
